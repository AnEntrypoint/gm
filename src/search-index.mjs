// Ranked search for the search and wiki_search tools. Each corpus has a SQLite database under .gm-new/index/, opened with node:sqlite,
// which is built into Node and has FTS5. The code corpus is the workspace's files, tracked or not, except ignored ones, sources/,
// vendor/, runs/ and .gm-new/. The wiki corpus is wiki/. A file is cut into chunks of 60 lines with 15 lines of overlap. Each chunk
// is indexed under its words, with the parts of camelCase and snake_case identifiers, and a query is ranked by FTS5 BM25. A query
// refreshes its corpus first: a file is read again only when its mtime or size changed, and a file that left the corpus is removed.
// The worker refreshes both corpora every five minutes in the background. A measured choice, not a default: over 18 natural and
// identifier queries on this repository, BM25 alone found the wanted file in the top five more often than a fusion with a
// 256-dimension static embedding, which lost identifier hits (DESIGN.md, Decisions 2026-11-02).
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CHUNK_LINES = 60;
const OVERLAP_LINES = 15;
const MAX_FILE_BYTES = 1000000;
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const LIST_TIMEOUT_MS = 30000;
const SNIPPET_LINES = 3;
const SNIPPET_CHARS = 120;
const OUTPUT_PAGE = 20000;
const DEFAULT_K = 10;
const POOL = 1000;
const MAX_K = 50;
const REFRESH_MS = 300000;
const CODE_EXCLUDE = ['.gm-new/', 'runs/', 'node_modules/', 'vendor/', 'sources/', 'wiki/'];

const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const SEARCH_INDEX_TOOLS = [
  {
    name: 'search',
    description: 'Find code by its words, ranked by BM25 over 60-line chunks. The workspace files are searched, tracked or not, except ignored ones, sources/, vendor/ and runs/. An identifier also matches its parts, so planWaves matches plan and waves. Each hit is one file: its best chunk, as path:start-end, a score and its first three lines. Read a hit with read_file for more. The index refreshes before each search. k is 1 to 50, default 10.',
    inputSchema: obj({ query: str, k: num }, ['query']),
  },
  {
    name: 'wiki_search',
    description: 'Find wiki pages (wiki/) by their words, ranked the same way as search. Each hit is the page path and lines, a score and its first three lines. The index refreshes before each search. k is 1 to 50, default 10.',
    inputSchema: obj({ query: str, k: num }, ['query']),
  },
];

export function createSearchIndexVerbs({ root, log }) {
  const corpora = {
    code: new Corpus({ name: 'code', root, pathspec: null, exclude: CODE_EXCLUDE, log }),
    wiki: new Corpus({ name: 'wiki', root, pathspec: 'wiki', exclude: [], log }),
  };
  const timer = setInterval(() => {
    for (const corpus of Object.values(corpora)) corpus.refresh().catch(() => {});
  }, REFRESH_MS);
  timer.unref();
  return {
    search: ({ query, k = DEFAULT_K }) => run(corpora.code, query, k),
    wiki_search: ({ query, k = DEFAULT_K }) => run(corpora.wiki, query, k),
  };
}

async function run(corpus, query, k) {
  if (typeof query !== 'string' || query.trim() === '') return { ok: false, error: 'query must be a non-empty string' };
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) return { ok: false, error: `k must be an integer from 1 to ${MAX_K}` };
  try {
    return { ok: true, output: formatHits(await corpus.search(query, k)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

class Corpus {
  constructor({ name, root, pathspec, exclude, log }) {
    Object.assign(this, { name, root, pathspec, exclude, log });
    this.db = null;
    this.running = null;
  }

  open() {
    if (this.db !== null) return this.db;
    const dir = join(this.root, '.gm-new', 'index');
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, `${this.name}.db`));
    db.exec('CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, path TEXT NOT NULL, line_start INTEGER NOT NULL, line_end INTEGER NOT NULL, content TEXT NOT NULL)');
    db.exec('CREATE INDEX IF NOT EXISTS chunks_path ON chunks (path)');
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(terms, tokenize = 'unicode61')");
    this.db = db;
    return db;
  }

  // One refresh at a time. A caller that arrives during a refresh waits for that refresh, and reads what it wrote.
  refresh() {
    if (this.running === null) this.running = this.doRefresh().finally(() => { this.running = null; });
    return this.running;
  }

  async doRefresh() {
    const db = this.open();
    const started = performance.now();
    const listed = await this.list();
    const known = new Map(db.prepare('SELECT path, mtime, size FROM files').all().map((row) => [row.path, row]));
    const changed = [];
    for (const [path, sig] of listed) {
      const old = known.get(path);
      if (old === undefined || old.mtime !== sig.mtime || old.size !== sig.size) changed.push(path);
    }
    const removed = [...known.keys()].filter((path) => !listed.has(path));
    if (changed.length === 0 && removed.length === 0) return;

    const pending = [];
    for (const path of changed) pending.push({ path, sig: listed.get(path), chunks: await this.chunksOf(path) });

    const dropTerms = db.prepare('DELETE FROM fts WHERE rowid IN (SELECT id FROM chunks WHERE path = ?)');
    const dropChunks = db.prepare('DELETE FROM chunks WHERE path = ?');
    const dropFile = db.prepare('DELETE FROM files WHERE path = ?');
    const insertChunk = db.prepare('INSERT INTO chunks (path, line_start, line_end, content) VALUES (?, ?, ?, ?)');
    const insertTerms = db.prepare('INSERT INTO fts (rowid, terms) VALUES (?, ?)');
    const upsertFile = db.prepare('INSERT OR REPLACE INTO files (path, mtime, size) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    try {
      for (const path of [...changed, ...removed]) {
        dropTerms.run(path);
        dropChunks.run(path);
        dropFile.run(path);
      }
      let added = 0;
      for (const item of pending) {
        for (const chunk of item.chunks) {
          const info = insertChunk.run(chunk.path, chunk.start, chunk.end, chunk.content);
          insertTerms.run(info.lastInsertRowid, termsOf(`${chunk.path} ${chunk.content}`).join(' '));
          added += 1;
        }
        upsertFile.run(item.path, item.sig.mtime, item.sig.size);
      }
      db.exec('COMMIT');
      this.log?.append('index', { corpus: this.name, files: listed.size, changed: changed.length, removed: removed.length, chunks: added, durMs: Math.round(performance.now() - started) });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // The files of the corpus, with the mtime and size of each. A symbolic link is not a file, so it is not read.
  async list() {
    const args = ['ls-files', '-co', '--exclude-standard', '-z'];
    if (this.pathspec !== null) args.push('--', this.pathspec);
    let stdout;
    try {
      ({ stdout } = await execFileAsync('git', args, { cwd: this.root, maxBuffer: MAX_LIST_BYTES, timeout: LIST_TIMEOUT_MS }));
    } catch {
      throw new Error('search needs a git repository: git ls-files failed');
    }
    const found = new Map();
    for (const path of stdout.split('\0')) {
      if (path === '' || this.exclude.some((prefix) => path.startsWith(prefix))) continue;
      let info;
      try {
        info = await lstat(join(this.root, path));
      } catch {
        continue;
      }
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
      found.set(path, { mtime: Math.floor(info.mtimeMs), size: info.size });
    }
    return found;
  }

  // The chunks of one file. A file with a NUL byte in its first 8000 bytes is binary, and it has no chunks.
  async chunksOf(path) {
    const buffer = await readFile(join(this.root, path));
    if (buffer.subarray(0, 8000).includes(0)) return [];
    const lines = buffer.toString('utf8').split('\n');
    const chunks = [];
    const step = CHUNK_LINES - OVERLAP_LINES;
    for (let start = 0; start < lines.length; start += step) {
      const end = Math.min(start + CHUNK_LINES, lines.length);
      const content = lines.slice(start, end).join('\n');
      if (content.trim() !== '') chunks.push({ path, start: start + 1, end, content });
      if (end === lines.length) break;
    }
    return chunks;
  }

  async search(query, k) {
    await this.refresh();
    const db = this.open();
    const words = [...new Set(termsOf(query))];
    if (words.length === 0) return [];
    const ranked = db.prepare('SELECT rowid AS id, bm25(fts) AS score FROM fts WHERE fts MATCH ? ORDER BY score LIMIT ?').all(words.map((word) => `"${word}"`).join(' OR '), POOL);
    const load = db.prepare('SELECT path, line_start, line_end, content FROM chunks WHERE id = ?');
    // One hit per file: the best chunk of each file, so overlapping chunks of one file do not fill the page.
    const seen = new Set();
    const hits = [];
    for (const row of ranked) {
      const chunk = load.get(row.id);
      if (seen.has(chunk.path)) continue;
      seen.add(chunk.path);
      hits.push({ path: chunk.path, start: chunk.line_start, end: chunk.line_end, score: -row.score, snippet: snippetOf(chunk.content) });
      if (hits.length === k) break;
    }
    return hits;
  }
}

// An identifier gives its whole lowercase form, and its camelCase or snake_case parts when it has more than one.
export function termsOf(text) {
  const out = [];
  for (const word of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    out.push(word.toLowerCase());
    const parts = word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_ ]+/).filter((part) => part !== '').map((part) => part.toLowerCase());
    if (parts.length > 1) out.push(...parts);
  }
  return out;
}

function snippetOf(content) {
  return content.split('\n').slice(0, SNIPPET_LINES).map((line) => (line.length > SNIPPET_CHARS ? `${line.slice(0, SNIPPET_CHARS)} ...` : line)).join('\n');
}

function formatHits(hits) {
  if (hits.length === 0) return '(no match)';
  const text = hits.map((hit) => `${hit.path}:${hit.start}-${hit.end} ${hit.score.toFixed(3)}\n${hit.snippet.split('\n').map((line) => `  > ${line}`).join('\n')}`);
  return text.join('\n').slice(0, OUTPUT_PAGE);
}
