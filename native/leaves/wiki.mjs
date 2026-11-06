const K1 = 1.2;
const B = 0.75;
const MAX_FILE_BYTES = 1000000;
const LIST_TIMEOUT_MS = 30000;
const SNIPPET_CHARS = 300;
const READ_PAGE = 20000;
const BINARY_PROBE = 8000;
const DEFAULT_K = 10;
const MAX_K = 50;
const ROOT_ARGS = ['root', 'projectPath', 'cwd'];
const SEARCH_TAKES = ['query', 'k'];
const PAGE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SOURCE = /^[0-9a-f]{12}$/;
const KINDS = ['ingest', 'answer', 'lint'];
const ENTRY = /^- \[\[([a-z0-9][a-z0-9-]{0,63})\]\] - (.+)$/;
const ROOT_NOTE = 'root (or its aliases projectPath and cwd) names another existing directory to search instead of the workspace; with a root other than the workspace, hits show absolute paths. An unknown argument is refused by name.';

const str = { type: 'string' };
const num = { type: 'number' };
const list = { type: 'array', items: str };
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const fail = (error) => ({ ok: false, error });
const refused = (reason) => ({ ok: false, refused: true, error: `refused: ${reason}` });

const isAscii = (text) => /^[\x00-\x7f]*$/.test(text);
const oneLine = (text) => typeof text === 'string' && text.trim() !== '' && !/[\r\n]/.test(text) && isAscii(text);
const asciiText = (text) => text.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
const isAbsolute = (path) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);

function normalizeAbsolute(path) {
  const drive = /^[A-Za-z]:/.test(path) ? path.slice(0, 2) : '';
  const parts = [];
  for (const part of path.slice(drive.length).split(/[\\/]/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${drive}/${parts.join('/')}`;
}

const resolveFrom = (base, path) => normalizeAbsolute(isAbsolute(path) ? path : `${base}/${path}`);

function readWhole(path) {
  let text = '';
  let offset = 0;
  for (;;) {
    const reply = host.read_file({ path, unit: 'chars', offset, limit: READ_PAGE });
    if (reply?.ok === false) return null;
    if (typeof reply?.content === 'string') return reply.content;
    text += reply?.output ?? '';
    if (reply?.next === null || reply?.next === undefined) return text;
    offset = reply.next;
  }
}

function statOf(path) {
  const reply = host.stat_file({ path });
  if (reply?.ok === false) return null;
  if (typeof reply?.output === 'string') {
    try {
      return JSON.parse(reply.output);
    } catch {
      return null;
    }
  }
  return reply;
}

function namesIn(path) {
  const reply = host.list_dir({ path });
  if (reply?.ok === false) return [];
  if (Array.isArray(reply)) return reply;
  return String(reply?.output ?? '').split('\n').filter((name) => name !== '');
}

const exists = (path) => statOf(path) !== null;
const writeText = (path, content) => {
  const reply = host.write_file({ path, content });
  if (reply?.ok === false) throw new Error(reply.error);
};

function tokensOf(text) {
  const out = [];
  for (const word of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    const whole = word.toLowerCase();
    out.push(whole);
    const parts = word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_ ]+/).filter((part) => part !== '').map((part) => part.toLowerCase());
    if (parts.length > 1) out.push(...parts);
  }
  return out;
}

function lineOf(text) {
  const tf = new Map();
  const tokens = tokensOf(text);
  for (const term of tokens) tf.set(term, (tf.get(term) ?? 0) + 1);
  return { text, len: tokens.length, tf };
}

function buildIndex(entries) {
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

function rank(index, terms, k) {
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

const snippet = (text) => (text.length <= SNIPPET_CHARS ? text : `${text.slice(0, SNIPPET_CHARS)} ...`);

const STATE_DIRS = new Set(['.git', '.gm', '.agentplug', '.agentplug-kv', '.playwriter', 'runs', 'node_modules', 'vendor']);

function wikiWalk(root) {
  const paths = [];
  const pending = [''];
  while (pending.length > 0) {
    const dir = pending.pop();
    for (const name of namesIn(`${root}/wiki/${dir}`)) {
      const isDir = name.endsWith('/');
      const bare = isDir ? name.slice(0, -1) : name;
      if (bare === '') continue;
      if (isDir) {
        if (bare.startsWith('.') || STATE_DIRS.has(bare)) continue;
        pending.push(dir === '' ? bare : `${dir}/${bare}`);
      } else {
        paths.push(`wiki/${dir === '' ? bare : `${dir}/${bare}`}`);
      }
    }
  }
  return paths.sort();
}

function noFilesError(root) {
  return `search and grep found no files in ${root}: git ls-files failed (not a git repository or git unavailable) and a directory walk found no files`;
}

function wikiEntries(root) {
  const listing = host.run({ argv: ['git', 'ls-files', '-z', '-co', '--exclude-standard', '--', 'wiki'], cwd: root, timeoutMs: LIST_TIMEOUT_MS });
  const gitFailed = !listing?.started || listing.timedOut || listing.exitCode !== 0;
  const rels = gitFailed ? wikiWalk(root) : listing.out.split('\0').filter((path) => path !== '');
  if (gitFailed && rels.length === 0) return { error: noFilesError(root) };
  const entries = [];
  for (const rel of rels) {
    const at = `${root}/${rel}`;
    const info = statOf(at);
    if (info === null || info.type !== 'file' || info.size > MAX_FILE_BYTES) continue;
    const text = readWhole(at);
    if (text === null) continue;
    const lines = text.slice(0, BINARY_PROBE).includes('\0') ? [] : text.split('\n').map((raw) => lineOf(raw.endsWith('\r') ? raw.slice(0, -1) : raw));
    entries.push({ rel, lines });
  }
  return { entries };
}

function homeOf(args) {
  const workspace = host.workspace;
  const given = ROOT_ARGS.filter((key) => args[key] !== undefined);
  if (given.length === 0) return { dir: workspace };
  for (const key of given) {
    if (typeof args[key] !== 'string' || args[key] === '') return { error: `${key} must be a non-empty path` };
  }
  const dirs = new Set(given.map((key) => resolveFrom(workspace, args[key])));
  if (dirs.size > 1) return { error: `${given.join(' and ')} name different roots; pass one` };
  const [dir] = dirs;
  const info = statOf(dir);
  if (info === null) return { error: `no such root: ${args[given[0]]}` };
  if (info.type !== 'dir' && info.isDirectory !== true) return { error: `root is not a directory: ${args[given[0]]}` };
  return { dir: dir === normalizeAbsolute(workspace) ? workspace : dir };
}

function wikiSearch(args = {}) {
  const unknown = Object.keys(args).filter((key) => !SEARCH_TAKES.includes(key) && !ROOT_ARGS.includes(key));
  if (unknown.length > 0) return refused(`unknown argument ${unknown.join(', ')}; wiki_search takes ${[...SEARCH_TAKES, 'root'].join(', ')}`);
  const home = homeOf(args);
  if (home.error) return refused(home.error);
  const { query, k = DEFAULT_K } = args;
  if (typeof query !== 'string' || query.trim() === '') return fail('query must be a non-empty string');
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) return fail(`k must be an integer from 1 to ${MAX_K}`);
  const terms = [...new Set(tokensOf(query))];
  if (terms.length === 0) return fail('query has no word characters');
  const listed = wikiEntries(home.dir);
  if (listed.error) return fail(listed.error);
  const shownAt = home.dir === host.workspace ? (rel) => rel : (rel) => `${home.dir}/${rel}`;
  const hits = rank(buildIndex(listed.entries), terms, k);
  const lines = hits.map(({ doc, score }) => `${shownAt(doc.path)}:${doc.line} ${score.toFixed(3)} ${snippet(doc.text)}`);
  return { ok: true, output: lines.length ? lines.join('\n') : '(no match)' };
}

function sourceText(root, id) {
  if (!SOURCE.test(id)) return null;
  const file = `${root}/sources/${id}.txt`;
  return exists(file) ? readWhole(file) : null;
}

const today = () => new Date().toISOString().slice(0, 10);

function wikiWrite({ root, page, title, body, summary, sources, claims = [], kind = 'ingest', contradicts = [], resolves = [] }) {
  const refuse = (error) => ({ ok: false, error: `refused: ${error}` });
  if (typeof page !== 'string' || !PAGE.test(page)) return refuse('page must be lowercase letters, digits and hyphens, at most 64 characters');
  const pageTitle = title ?? page;
  if (!oneLine(pageTitle)) return refuse('title must be one line of ASCII');
  if (typeof body !== 'string' || !isAscii(body)) return refuse('body must be ASCII text; write non-ASCII as \\uXXXX');
  if (!oneLine(summary)) return refuse('summary must be one line of ASCII');
  if (!KINDS.includes(kind)) return refuse(`kind must be one of ${KINDS.join(', ')}`);
  if (!Array.isArray(sources) || sources.length === 0 || !sources.every((id) => typeof id === 'string' && SOURCE.test(id))) {
    return refuse('sources must be a non-empty list of source ids');
  }
  for (const id of sources) if (sourceText(root, id) === null) return refuse(`source ${id} is not in sources/`);
  if (!Array.isArray(claims)) return refuse('claims must be a list of {quote, source}');
  for (const [i, claim] of claims.entries()) {
    if (!claim || typeof claim.quote !== 'string' || claim.quote === '' || !sources.includes(claim.source)) {
      return refuse(`claim ${i + 1} needs a quote and a source that is listed in sources`);
    }
    if (!sourceText(root, claim.source).includes(asciiText(claim.quote))) return refuse(`claim ${i + 1}: the quote is not in source ${claim.source}`);
  }
  for (const names of [contradicts, resolves]) {
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string' && PAGE.test(name))) return refuse('contradicts and resolves must be lists of page names');
  }

  const dir = `${root}/wiki`;
  const front = [
    '---',
    `title: ${JSON.stringify(pageTitle)}`,
    `updated: ${JSON.stringify(new Date().toISOString())}`,
    `sources: ${JSON.stringify(sources)}`,
    `claims: ${JSON.stringify(claims.map(({ quote, source }) => ({ quote: asciiText(quote), source })))}`,
    `contradicts: ${JSON.stringify(contradicts)}`,
    `resolves: ${JSON.stringify(resolves)}`,
    '---',
  ].join('\n');
  writeText(`${dir}/${page}.md`, `${front}\n${body.endsWith('\n') ? body : `${body}\n`}`);

  const indexPath = `${dir}/index.md`;
  const rows = (exists(indexPath) ? readWhole(indexPath) : '# Index\n\n').split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  const entry = `- [[${page}]] - ${summary}`;
  const at = rows.findIndex((row) => row.startsWith(`- [[${page}]] - `));
  if (at >= 0) rows[at] = entry;
  else rows.push(entry);
  writeText(indexPath, `${rows.join('\n')}\n`);

  const logPath = `${dir}/log.md`;
  const logBefore = exists(logPath) ? readWhole(logPath) : '# Log\n\n';
  writeText(logPath, `${logBefore}## [${today()}] ${kind} | ${pageTitle}\n`);
  host.logAppend({ kind: 'wiki', fields: { page, writeKind: kind, sources: sources.length, claims: claims.length } });
  return { ok: true, output: `wrote wiki/${page}.md, its index entry and its log line`, page: `wiki/${page}.md`, claims: claims.length };
}

const linksIn = (text) => [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]);

function parsePage(text) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(': ');
    if (at > 0) fields[line.slice(0, at)] = JSON.parse(line.slice(at + 2));
  }
  return {
    title: fields.title ?? '',
    updated: fields.updated ?? '',
    sources: fields.sources ?? [],
    claims: fields.claims ?? [],
    contradicts: fields.contradicts ?? [],
    resolves: fields.resolves ?? [],
    body: match[2],
  };
}

function registryOf(root, problems) {
  const file = `${root}/sources/index.jsonl`;
  if (!exists(file)) return [];
  try {
    return (readWhole(file) ?? '').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    problems.push('sources/index.jsonl is not JSON lines');
    return [];
  }
}

function lintWiki(root) {
  const dir = `${root}/wiki`;
  if (!exists(dir)) return { problems: [], pages: 0, skipped: true };
  const problems = [];
  const indexPath = `${dir}/index.md`;
  const logPath = `${dir}/log.md`;
  const hasIndex = exists(indexPath);
  const hasLog = exists(logPath);
  if (!hasIndex) problems.push('wiki/index.md is missing');
  if (!hasLog) problems.push('wiki/log.md is missing');
  const indexText = hasIndex ? (readWhole(indexPath) ?? '') : '';
  const logText = hasLog ? (readWhole(logPath) ?? '') : '';

  const indexed = new Set();
  for (const row of indexText.split('\n')) {
    const match = ENTRY.exec(row);
    if (match) indexed.add(match[1]);
  }
  const pages = new Map();
  for (const file of namesIn(dir).filter((name) => name.endsWith('.md') && name !== 'index.md' && name !== 'log.md').sort()) {
    const parsed = parsePage(readWhole(`${dir}/${file}`) ?? '');
    if (parsed) pages.set(file.slice(0, -3), parsed);
    else problems.push(`wiki/${file} has no frontmatter`);
  }

  for (const name of pages.keys()) if (!indexed.has(name)) problems.push(`page ${name} has no entry in wiki/index.md`);
  for (const name of indexed) if (!pages.has(name)) problems.push(`wiki/index.md lists ${name}, which has no page`);
  for (const target of linksIn(indexText)) if (!pages.has(target)) problems.push(`wiki/index.md links to ${target}, which has no page`);

  const linkedFrom = new Set();
  for (const [name, page] of pages) {
    for (const target of linksIn(page.body)) {
      if (!pages.has(target)) problems.push(`page ${name} links to ${target}, which has no page`);
      else if (target !== name) linkedFrom.add(target);
    }
  }
  for (const name of pages.keys()) if (!linkedFrom.has(name)) problems.push(`page ${name} is an orphan: no other page links to it`);

  const logTitles = new Set(logText.split('\n').map((row) => /^## \[\d{4}-\d{2}-\d{2}\] (?:ingest|answer|lint) \| (.+)$/.exec(row)?.[1]).filter(Boolean));
  for (const [name, page] of pages) {
    if (!logTitles.has(page.title)) problems.push(`page ${name} has no line in wiki/log.md`);
    for (const id of page.sources) if (sourceText(root, id) === null) problems.push(`page ${name} cites source ${id}, which is not in sources/`);
    for (const claim of page.claims) {
      if (!page.sources.includes(claim.source)) problems.push(`page ${name} has a claim from ${claim.source}, which it does not list`);
      const text = sourceText(root, claim.source);
      if (text !== null && !text.includes(claim.quote)) problems.push(`page ${name}: a quote is no longer in source ${claim.source}`);
    }
  }

  const registry = registryOf(root, problems);
  for (const [name, page] of pages) {
    for (const id of page.sources) {
      const url = registry.find((entry) => entry.id === id)?.url;
      const latest = url === undefined ? undefined : registry.filter((entry) => entry.url === url).at(-1);
      if (latest && latest.id !== id && Date.parse(latest.at) > Date.parse(page.updated)) {
        problems.push(`page ${name} cites source ${id}, but ${url} was archived again as ${latest.id} at ${latest.at}`);
      }
    }
  }

  for (const [name, page] of pages) {
    for (const other of page.contradicts) {
      if (!pages.has(other)) {
        problems.push(`page ${name} contradicts ${other}, which has no page`);
        continue;
      }
      const resolved = [...pages].some(
        ([later, body]) => later !== name && (body.resolves.includes(name) || body.resolves.includes(other)) && Date.parse(body.updated) > Date.parse(page.updated),
      );
      if (!resolved) problems.push(`open contradiction: ${name} contradicts ${other}`);
    }
    for (const other of page.resolves) if (!pages.has(other)) problems.push(`page ${name} resolves ${other}, which has no page`);
  }

  const claims = [...pages.values()].reduce((sum, page) => sum + page.claims.length, 0);
  return { problems, pages: pages.size, claims, skipped: false };
}

function wikiWriteVerb(args = {}) {
  const result = wikiWrite({
    root: host.workspace,
    page: args.page,
    title: args.title,
    body: args.body,
    summary: args.summary,
    sources: args.sources ?? [],
    claims: args.claims ?? [],
    kind: args.kind ?? 'ingest',
    contradicts: args.contradicts ?? [],
    resolves: args.resolves ?? [],
  });
  return result.ok ? { ok: true, output: JSON.stringify(result) } : result;
}

function wikiLintVerb() {
  const lint = lintWiki(host.workspace);
  return { ok: true, output: JSON.stringify(lint), ...lint };
}

export const verbs = [
  {
    name: 'wiki_search',
    description: `Rank the lines of the wiki pages (wiki/, tracked or not) by BM25 and return the best k as path:line score text, the same way as search. k is 1 to 50, default 10. ${ROOT_NOTE}`,
    inputSchema: obj({ query: str, k: num, root: str }, ['query']),
    call: wikiSearch,
  },
  {
    name: 'wiki_write',
    description: 'Write a wiki page, wiki/<page>.md, with its source ids and its claims. A claim quote must appear in its named source (sources/<id>.txt), or the whole page is refused and nothing is written. Updates wiki/index.md and wiki/log.md. kind is ingest (default), answer or lint. page is lowercase letters, digits and hyphens. contradicts and resolves name pages.',
    inputSchema: obj({ page: str, title: str, body: str, summary: str, sources: list, claims: { type: 'array', items: { type: 'object' } }, kind: str, contradicts: list, resolves: list }, ['page', 'title', 'body', 'summary', 'sources']),
    call: wikiWriteVerb,
  },
  {
    name: 'wiki_lint',
    description: 'Lint the wiki: index and log entries, links, orphans, claim quotes against their sources, stale sources and open contradictions. Returns problems (one line each), pages, claims and skipped (true when there is no wiki/). finish runs it.',
    inputSchema: obj({}),
    call: wikiLintVerb,
  },
];
