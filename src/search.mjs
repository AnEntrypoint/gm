import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { resultZone1 } from './compact.mjs';
import { closureLines } from './closure.mjs';

const execFileAsync = promisify(execFile);
const K1 = 1.2;
const B = 0.75;
const MAX_FILE_BYTES = 1000000;
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const LIST_TIMEOUT_MS = 30000;
const SNIPPET_CHARS = 300;
const OUTPUT_PAGE = 20000;
const DEFAULT_K = 10;
const MAX_K = 50;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_PATTERN_CHARS = 200;
const MAX_MATCH_CHARS = 1024;
const MAX_SCAN_FILES = 4096;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const SCAN_DEADLINE_MS = 10000;
const MODES = ['literal', 'regex', 'word'];
const MODE_ALIASES = new Map([['content', 'literal']]);
const REGEX_CHARS = /[.|()[\]{}*+?^$\\]/;
const TRACKED = { name: 'tracked', args: ['ls-files', '-z'], cached: true };
const WIKI = { name: 'wiki', args: ['ls-files', '-z', '-co', '--exclude-standard', '--', 'wiki'], cached: false };
const SCOPES = ['tracked', 'all'];
const ALL_FILES = { name: 'all', args: ['ls-files', '-z', '-c', '-o'], cached: false };
const UNTRACKED = { name: 'untracked', args: ['ls-files', '-z', '-o', '--exclude-standard'], cached: false };
const STATE_DIRS = new Set(['.git', '.gm', '.agentplug', '.agentplug-kv', '.gm', '.playwriter', 'runs']);
const STAMP_SETTLE_MS = 3000;
const VENDOR = /(^|\/)(node_modules|vendor)\//;

const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const ROOT_NOTE = 'root (or its aliases projectPath and cwd) names another existing directory to search instead of the workspace; with a root other than the workspace, hits show absolute paths. An unknown argument is refused by name.';

export const SEARCH_TOOLS = [
  {
    name: 'search',
    description: `Rank the lines of git-tracked files (outside a git repository, every file under the root) by BM25 and return the best k as path:line score text. An identifier also matches its parts, so planWaves matches plan and waves. k is 1 to 50, default 10. closure true (default false) adds one line per JavaScript file that defines a function called from a top-10 hit and is not itself a top-10 file, as path:line closure text in place of a score, at most 20 lines. ${ROOT_NOTE}`,
    inputSchema: obj({ query: str, k: num, root: str, closure: bool }, ['query']),
  },
  {
    name: 'wiki_search',
    description: `Rank the lines of the wiki pages (wiki/, tracked or not) by BM25 and return the best k as path:line score text, the same way as search. k is 1 to 50, default 10. ${ROOT_NOTE}`,
    inputSchema: obj({ query: str, k: num, root: str }, ['query']),
  },
  {
    name: 'grep',
    description: `Find text in the files under path: the workspace by default, or a file or directory of it. A path inside the workspace searches its git-tracked files (or, outside a git repository, every file under it); a path outside the workspace is walked and its hits show absolute paths. files is git or walk, the source used. mode is literal (default; also named content), regex, or word (a whole identifier). If a literal search finds nothing and the pattern has a regex character, the pattern runs once more as a regex; the hint says which pass matched, and a pattern that is not a valid regex is an error. scope is tracked (default) or all: all also searches untracked and gitignored files, node_modules included, and skips .git and the state directories .gm, .agentplug, .agentplug-kv, .gm, .playwriter and runs. A tracked search that skips files says how many in a hint and names scope all. Returns path:line text. ignoreCase is optional; limit is 1 to 1000, default 100. Paths under node_modules/ or vendor/ are skipped by tracked unless vendor is true; a walk also skips dot-directories and runs/. all lists files with git ls-files, which has a 30 s limit, so a large tree can take longer. ${ROOT_NOTE}`,
    inputSchema: obj({ pattern: str, path: str, mode: str, scope: str, ignoreCase: bool, limit: num, offset: num, vendor: bool, root: str }, ['pattern']),
  },
];

const ROOT_ARGS = ['root', 'projectPath', 'cwd'];
const TAKES = {
  search: ['query', 'k', 'closure'],
  wiki_search: ['query', 'k'],
  grep: ['pattern', 'path', 'mode', 'scope', 'ignoreCase', 'limit', 'offset', 'vendor'],
};
const MAX_SEARCH_ROOTS = 4;

export const COMPACT = {
  tools: {
    search: { zone1: resultZone1, zone2: () => null },
    grep: { zone1: resultZone1, zone2: () => null },
    wiki_search: { zone1: resultZone1, zone2: () => null },
  },
};

export function createSearchVerbs({ root, confine }) {
  const searchers = new Map();
  const searcherAt = (dir) => {
    if (searchers.has(dir)) {
      const known = searchers.get(dir);
      searchers.delete(dir);
      searchers.set(dir, known);
      return known;
    }
    if (searchers.size === MAX_SEARCH_ROOTS) searchers.delete(searchers.keys().next().value);
    const made = searcherFor({ root: dir, confine: dir === root ? confine : null });
    searchers.set(dir, made);
    return made;
  };
  const verb = (name, run) => async (args = {}) => {
    const unknown = Object.keys(args).filter((key) => !TAKES[name].includes(key) && !ROOT_ARGS.includes(key));
    if (unknown.length > 0) return refused(`unknown argument ${unknown.join(', ')}; ${name} takes ${[...TAKES[name], 'root'].join(', ')}`);
    const home = homeOf(args);
    if (home.error) return refused(home.error);
    return run(searcherAt(home.dir), args);
  };
  return {
    search: verb('search', (searcher, args) => searcher.search(args)),
    wiki_search: verb('wiki_search', (searcher, args) => searcher.wiki_search(args)),
    grep: verb('grep', (searcher, args) => searcher.grep(args)),
  };

  function homeOf(args) {
    const given = ROOT_ARGS.filter((key) => args[key] !== undefined);
    if (given.length === 0) return { dir: root };
    for (const key of given) {
      if (typeof args[key] !== 'string' || args[key] === '') return { error: `${key} must be a non-empty path` };
    }
    const dirs = new Set(given.map((key) => resolve(root, args[key])));
    if (dirs.size > 1) return { error: `${given.join(' and ')} name different roots; pass one` };
    const [dir] = dirs;
    const isDirectory = directoryOrNull(dir);
    if (isDirectory === null) return { error: `no such root: ${args[given[0]]}` };
    if (!isDirectory) return { error: `root is not a directory: ${args[given[0]]}` };
    return { dir };
  }
}

function directoryOrNull(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return null;
  }
}

function refused(reason) {
  return { ok: false, refused: true, error: `refused: ${reason}` };
}

function searcherFor({ root, confine }) {
  const filesOf = new Map();
  const built = new Map();
  const targetOf = (rel) => (confine === null ? { path: join(root, rel) } : confine(rel));
  const shownAt = (rel) => (confine === null ? join(root, rel) : rel);

  return {
    async search(args) {
      return searchWith(TRACKED, args);
    },

    async wiki_search(args) {
      return searchWith(WIKI, args);
    },

    async grep({ pattern, path, mode: requested = 'literal', scope: coverage = 'tracked', ignoreCase = false, limit = DEFAULT_LIMIT, offset = 0, vendor = false }) {
      if (typeof pattern !== 'string' || pattern === '') return fail('pattern must be a non-empty string');
      if (pattern.length > MAX_PATTERN_CHARS) return fail(`pattern must be at most ${MAX_PATTERN_CHARS} characters`);
      const mode = MODE_ALIASES.get(requested) ?? requested;
      if (!MODES.includes(mode)) return fail(`mode must be one of ${MODES.join(', ')}`);
      if (!SCOPES.includes(coverage)) return fail(`scope must be one of ${SCOPES.join(', ')}`);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return fail(`limit must be an integer from 1 to ${MAX_LIMIT}`);
      if (typeof vendor !== 'boolean') return fail('vendor must be true or false');
      if (path !== undefined && (typeof path !== 'string' || path === '')) return fail('path must be a non-empty string');
      let matches;
      try {
        matches = matcherFor(pattern, mode, ignoreCase === true);
      } catch (err) {
        return fail(`bad pattern: ${err.message}`);
      }
      const budget = { listed: 0, files: 0, bytes: 0, deadline: Date.now() + SCAN_DEADLINE_MS, walkStopped: false, scanStopped: false };
      const budgetHit = () => budget.walkStopped || budget.scanStopped;
      const budgetHint = () => `scan budget hit: stopped after ${budget.files} files and ${budget.bytes} bytes; narrow the root or pass a path`;
      const scope = resolve(root, path ?? '.');
      if ((await lstat(scope).catch(() => null)) === null) return fail(`no such path: ${path}`);
      const inside = within(root, scope);
      const listing = inside ? await trackedFiles(root, TRACKED) : { error: 'outside the workspace' };
      const source = listing.error ? 'walk' : 'git';
      const base = listing.error ? scope : root;
      const under = relative(root, scope);
      const all = coverage === 'all';
      const walked = listing.error ? await walkFiles(scope, all, vendor, budget) : null;
      let names;
      if (walked !== null) {
        names = walked.paths;
      } else if (all) {
        const every = await trackedFiles(root, ALL_FILES);
        if (every.error) return fail(`scope all: git ls-files failed or ran past its ${LIST_TIMEOUT_MS / 1000} s limit`);
        const tracked = new Set(listing.paths);
        names = trackedUnder(every.paths, under, true).filter((rel) => !rel.endsWith('/') && (tracked.has(rel) || !inState(rel)));
      } else {
        names = trackedUnder(listing.paths, under, vendor);
      }
      if (!Number.isInteger(offset) || offset < 0) return fail('offset must be a whole number, zero or more');
      const scan = async (matchesLine) => {
        const found = [];
        let total = 0;
        let size = 0;
        let next = null;
        for (const name of names) {
          if (budget.scanStopped || budget.files >= MAX_SCAN_FILES || budget.bytes >= MAX_SCAN_BYTES || budgetExpired(budget)) {
            budget.scanStopped = true;
            break;
          }
          budget.files += 1;
          const at = join(base, name);
          const read = await readLines(at, inside);
          if (read === null) continue;
          budget.bytes += read.bytes;
          const shown = inside && confine !== null ? relative(root, at).split(sep).join('/') : at;
          for (let i = 0; i < read.lines.length; i += 1) {
            if (i % 256 === 0 && budgetExpired(budget)) {
              budget.scanStopped = true;
              break;
            }
            const text = matchPrefix(read.lines[i]);
            if (!matchesLine(text)) continue;
            total += 1;
            if (total <= offset || next !== null) continue;
            const row = `${shown}:${i + 1} ${shownText(shown, text)}`;
            if (found.length >= limit || size + row.length > OUTPUT_PAGE) {
              next = total - 1;
              continue;
            }
            found.push(row);
            size += row.length + 1;
          }
          if (budget.scanStopped) break;
        }
        return { found, total, next };
      };
      let scanned = await scan(matches);
      const hints = [];
      if (scanned.total === 0 && mode === 'literal' && REGEX_CHARS.test(pattern)) {
        let asRegex;
        try {
          asRegex = matcherFor(pattern, 'regex', ignoreCase === true);
        } catch (err) {
          return fail(`no literal match, and the pattern is not a valid regex: ${err.message}`);
        }
        scanned = await scan(asRegex);
        hints.push(scanned.total > 0 ? 'no literal match; matched as regex' : 'no match as literal or regex');
      }
      const { found, total, next } = scanned;
      const footer = [`(${total} matches; showing ${found.length ? offset : 0} to ${offset + found.length}; ${next === null ? 'no more' : `next offset ${next}`})`];
      const skipped = all || total > 0 ? null : walked !== null ? walkSkipHint(walked.skippedDirs) : await skippedHint(listing, under, vendor);
      if (skipped !== null) hints.push(skipped);
      if (budgetHit()) hints.push(budgetHint());
      return { ok: true, files: source, output: [...found, ...footer].join('\n'), ...(hints.length ? { hint: hints.join(' | ') } : {}) };
    },
  };

  async function skippedHint(listing, under, vendor) {
    const every = await trackedFiles(root, ALL_FILES);
    const untracked = await trackedFiles(root, UNTRACKED);
    if (every.error || untracked.error) return 'skipped files not counted: git ls-files failed or ran past its limit';
    const tracked = new Set(listing.paths);
    const loose = new Set(untracked.paths);
    const skipped = trackedUnder(every.paths, under, true).filter((rel) => !rel.endsWith('/') && (tracked.has(rel) ? (!vendor && VENDOR.test(rel)) : !inState(rel)));
    if (skipped.length === 0) return null;
    const untrackedCount = skipped.filter((rel) => !tracked.has(rel) && loose.has(rel) && !VENDOR.test(rel)).length;
    return `${plural(skipped.length, 'file')} skipped (${untrackedCount} untracked, ${skipped.length - untrackedCount} gitignored or in node_modules); use scope: 'all' to include them`;
  }

  async function searchWith(listing, { query, k = DEFAULT_K, closure = false }) {
    if (typeof query !== 'string' || query.trim() === '') return fail('query must be a non-empty string');
    if (!Number.isInteger(k) || k < 1 || k > MAX_K) return fail(`k must be an integer from 1 to ${MAX_K}`);
    if (typeof closure !== 'boolean') return fail('closure must be true or false');
    const terms = [...new Set(tokensOf(query))];
    if (terms.length === 0) return fail('query has no word characters');
    const indexed = await currentIndex(listing);
    if (indexed.error) return fail(indexed.error);
    const hits = rank(indexed.index, terms, k);
    const lines = hits.map(({ doc, score }) => {
      const shown = shownAt(doc.path);
      return `${shown}:${doc.line} ${score.toFixed(3)} ${shownText(shown, doc.text)}`;
    });
    if (closure) lines.push(...closureLines(indexed.entries, hits, { shownAt, snippet }));
    return { ok: true, output: lines.length ? lines.join('\n') : '(no match)' };
  }

  async function currentIndex(listing) {
    const listed = await loadFiles(listing);
    if (listed.error) return { error: listed.error };
    const key = JSON.stringify(listed.entries.map((entry) => [entry.rel, entry.digest]));
    const cached = built.get(listing.name);
    if (cached !== undefined && cached.key === key) return { index: cached.index, entries: listed.entries };
    const next = { key, index: buildIndex(listed.entries) };
    built.set(listing.name, next);
    return { index: next.index, entries: listed.entries };
  }

  async function loadFiles(listing = TRACKED) {
    const tracked = await listedFiles(root, listing);
    if (tracked.error) return tracked;
    const previous = filesOf.get(listing.name) ?? new Map();
    const next = new Map();
    const entries = [];
    for (const rel of tracked.paths) {
      const entry = await loadFile(rel, previous.get(rel));
      if (entry === null) continue;
      next.set(rel, entry);
      entries.push(entry);
    }
    filesOf.set(listing.name, next);
    return { entries };
  }

  async function readLines(at, inside) {
    const target = inside && confine !== null ? confine(relative(root, at)) : { path: at };
    if (target.refused) return null;
    let info;
    try {
      info = await lstat(target.path);
    } catch {
      return null;
    }
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    const buffer = await readFile(target.path);
    if (buffer.subarray(0, 8000).includes(0)) return null;
    return { bytes: info.size, lines: buffer.toString('utf8').split('\n').map((raw) => (raw.endsWith('\r') ? raw.slice(0, -1) : raw)) };
  }

  async function loadFile(rel, known) {
    const at = targetOf(rel);
    if (at.refused) return null;
    let info;
    try {
      info = await lstat(at.path);
    } catch {
      return null;
    }
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    const stamp = stampOf(info);
    if (known && known.stamp === stamp && known.settled) return known;
    const readAt = Date.now();
    const buffer = await readFile(at.path);
    const digest = createHash('sha1').update(buffer).digest('hex');
    const settled = settledAt(info, readAt);
    if (known && known.digest === digest) return { ...known, stamp, settled };
    const binary = buffer.subarray(0, 8000).includes(0);
    const lines = binary ? [] : buffer.toString('utf8').split('\n').map((raw) => lineOf(raw.endsWith('\r') ? raw.slice(0, -1) : raw));
    return { rel, stamp, settled, digest, lines };
  }
}

const listings = new Map();
async function trackedFiles(root, listing) {
  const readAt = Date.now();
  const index = indexStamp(root, readAt);
  const known = listings.get(listing.name);
  if (listing.cached && index !== null && index.settled && known !== undefined && known.key === index.key && known.root === root) return { paths: known.paths };
  try {
    const { stdout } = await execFileAsync('git', listing.args, { cwd: root, maxBuffer: MAX_LIST_BYTES, timeout: LIST_TIMEOUT_MS });
    const paths = stdout.split('\0').filter((path) => path !== '');
    if (listing.cached && index !== null && index.settled) listings.set(listing.name, { key: index.key, root, paths });
    return { paths };
  } catch {
    return { error: 'search and grep need a git repository: git ls-files failed' };
  }
}

async function listedFiles(root, listing) {
  const tracked = await trackedFiles(root, listing);
  if (!tracked.error) return tracked;
  const under = listing === WIKI ? 'wiki' : '';
  const walked = await walkFiles(join(root, under), false, false);
  if (walked.paths.length === 0) return tracked;
  return { paths: walked.paths.map((rel) => (under === '' ? rel : `${under}/${rel}`)) };
}

async function walkFiles(base, all, vendor, budget = null) {
  if ((await lstat(base).catch(() => null))?.isFile()) return { paths: [''], skippedDirs: 0 };
  const paths = [];
  let skippedDirs = 0;
  const pending = [''];
  while (pending.length > 0 && !budget?.walkStopped) {
    if (budget && budgetExpired(budget)) {
      budget.walkStopped = true;
      break;
    }
    const dir = pending.pop();
    let entries;
    try {
      entries = await readdir(join(base, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (budget && budgetExpired(budget)) {
        budget.walkStopped = true;
        break;
      }
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (STATE_DIRS.has(entry.name)) continue;
        if (!all && skippedDirectory(entry.name, vendor)) skippedDirs += 1;
        else pending.push(rel);
      } else if (entry.isFile()) {
        if (budget && budget.listed >= MAX_SCAN_FILES) {
          budget.walkStopped = true;
          break;
        }
        paths.push(rel);
        if (budget) budget.listed += 1;
      }
    }
  }
  return { paths: paths.sort(), skippedDirs };
}

function skippedDirectory(name, vendor) {
  if (name.startsWith('.') || name === 'runs') return true;
  return !vendor && (name === 'node_modules' || name === 'vendor');
}

function inState(rel) {
  return rel.split('/').slice(0, -1).some((part) => STATE_DIRS.has(part));
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function walkSkipHint(dirs) {
  return dirs === 0 ? null : `${plural(dirs, 'directory', 'directories')} skipped (dot-directories, node_modules, vendor or runs); use scope: 'all' to include them`;
}

function trackedUnder(paths, dir, vendor) {
  const prefix = dir.split(sep).join('/');
  return paths.filter((rel) => (prefix === '' || rel === prefix || rel.startsWith(`${prefix}/`)) && (vendor || !VENDOR.test(rel)));
}

function within(base, target) {
  const rel = relative(base, target);
  return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel));
}

function stampOf(info) {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

function settledAt(info, readAt) {
  return info.mtimeMs < readAt - STAMP_SETTLE_MS && info.ctimeMs < readAt - STAMP_SETTLE_MS;
}

function indexStamp(root, readAt) {
  try {
    const info = statSync(join(root, '.git', 'index'));
    return { key: stampOf(info), settled: settledAt(info, readAt) };
  } catch {
    return null;
  }
}

export function lineOf(text) {
  const tf = new Map();
  const tokens = tokensOf(text);
  for (const term of tokens) tf.set(term, (tf.get(term) ?? 0) + 1);
  return { text, len: tokens.length, tf };
}

export function buildIndex(entries) {
  const docs = [];
  for (const entry of entries) {
    entry.lines.forEach((line, i) => {
      if (line.len > 0) docs.push({ path: entry.rel, line: i + 1, text: line.text, len: line.len, tf: line.tf });
    });
  }
  const postings = new Map();
  docs.forEach((doc, id) => {
    for (const term of doc.tf.keys()) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push(id);
    }
  });
  const avg = docs.reduce((sum, doc) => sum + doc.len, 0) / Math.max(docs.length, 1);
  return { docs, postings, avg };
}

export function rank(index, terms, k) {
  const scores = new Map();
  const n = index.docs.length;
  for (const term of terms) {
    const ids = index.postings.get(term);
    if (!ids) continue;
    const idf = Math.log(1 + (n - ids.length + 0.5) / (ids.length + 0.5));
    for (const id of ids) {
      const doc = index.docs[id];
      const tf = doc.tf.get(term);
      const weight = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.len) / index.avg));
      scores.set(id, (scores.get(id) ?? 0) + idf * weight);
    }
  }
  return [...scores]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([id, score]) => ({ doc: index.docs[id], score }));
}

export function tokensOf(text) {
  const out = [];
  for (const word of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    const whole = word.toLowerCase();
    out.push(whole);
    const parts = word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_ ]+/).filter((part) => part !== '').map((part) => part.toLowerCase());
    if (parts.length > 1) out.push(...parts);
  }
  return out;
}

function matcherFor(pattern, mode, ignoreCase) {
  const flags = ignoreCase ? 'i' : '';
  if (mode === 'regex') {
    const re = new RegExp(pattern, flags);
    return (text) => re.test(text);
  }
  if (mode === 'word') {
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(pattern)}(?![A-Za-z0-9_])`, flags);
    return (text) => re.test(text);
  }
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  return (text) => (ignoreCase ? text.toLowerCase() : text).includes(needle);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snippet(text) {
  return text.length <= SNIPPET_CHARS ? text : `${text.slice(0, SNIPPET_CHARS)} ...`;
}

function matchPrefix(text) {
  if (text.length <= MAX_MATCH_CHARS) return text;
  let cut = MAX_MATCH_CHARS;
  while (cut > 0 && (text.charCodeAt(cut) & 0xfc00) === 0xdc00) cut -= 1;
  return text.slice(0, cut);
}

function budgetExpired(budget) {
  return Date.now() >= budget.deadline;
}

function isDotenv(shown) {
  const name = shown.split(/[\\/]/).pop().toLowerCase();
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env') || name.includes('.env.');
}

function shownText(shown, text) {
  if (!isDotenv(shown)) return snippet(text);
  const at = text.indexOf('=');
  return snippet(at < 0 ? '<redacted>' : `${text.slice(0, at + 1)}<redacted>`);
}

function fail(error) {
  return { ok: false, error };
}
