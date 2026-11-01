import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SOURCE = /\.(?:js|mjs|cjs|ts)$/;
const MAX_FILE_BYTES = 1000000;
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const LIST_TIMEOUT_MS = 30000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 5;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const NOTE = 'approximate: regex over the tracked source files. Dynamic calls, re-exports and shadowed names are not resolved. A line that starts with a comment marker is skipped.';

const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const CODE_TOOLS = [
  {
    name: 'callers',
    description: 'Call sites of an identifier in tracked .js, .mjs, .cjs and .ts files, as path:line [kind] text. kind is linked (a direct call in a file that imports a defining file), direct, or member (x.name()). Definitions are not listed. Every answer is approximate. limit is 1 to 1000, default 100.',
    inputSchema: obj({ name: str, limit: num }, ['name']),
  },
  {
    name: 'impact',
    description: 'Files affected if an identifier changes: the files that define it, the files that call it, and the files that import those, out to depth levels (default 2, max 5). Every answer is approximate.',
    inputSchema: obj({ name: str, depth: num }, ['name']),
  },
];

export function createCodeVerbs({ root, confine }) {
  return {
    async callers({ name, limit = DEFAULT_LIMIT }) {
      const bad = badArgs(name);
      if (bad) return fail(bad);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return fail(`limit must be an integer from 1 to ${MAX_LIMIT}`);
      const index = await loadIndex(root, confine);
      if (index.error) return fail(index.error);
      const found = scan(index, name);
      const sites = [...found.direct, ...found.member].sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
      const shown = sites.slice(0, limit).map((site) => `${site.rel}:${site.line} [${site.kind}] ${site.text.trim()}`);
      const footer = `(${sites.length} call sites in ${index.files.length} files; ${NOTE})`;
      return { ok: true, output: [...shown, footer].join('\n') };
    },

    async impact({ name, depth = DEFAULT_DEPTH }) {
      const bad = badArgs(name);
      if (bad) return fail(bad);
      if (!Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) return fail(`depth must be an integer from 0 to ${MAX_DEPTH}`);
      const index = await loadIndex(root, confine);
      if (index.error) return fail(index.error);
      const found = scan(index, name);
      const callFiles = new Set([...found.direct, ...found.member].map((site) => site.rel));
      const seen = new Set([...found.defs.map((def) => def.rel), ...callFiles]);
      const levels = [];
      let frontier = [...seen];
      for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
        const next = new Set();
        for (const rel of frontier) for (const importer of index.importers.get(rel) ?? []) if (!seen.has(importer)) next.add(importer);
        frontier = [...next].sort();
        for (const rel of frontier) seen.add(rel);
        if (frontier.length > 0) levels.push(`imported by depth ${level}: ${frontier.join(', ')}`);
      }
      const out = [
        `approximate impact of ${name}: ${found.defs.length} definitions, ${callFiles.size} files call it`,
        ...found.defs.map((def) => `defines: ${def.rel}:${def.line} ${def.text.trim()}`),
        callFiles.size > 0 ? `calls in: ${[...callFiles].sort().join(', ')}` : 'calls in: (none found)',
        ...levels,
        `(${NOTE})`,
      ];
      return { ok: true, output: out.join('\n') };
    },
  };
}

// The index holds every tracked source file, its lines, and the import edges between files that resolve inside the repo.
async function loadIndex(root, confine) {
  let paths;
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: MAX_LIST_BYTES, timeout: LIST_TIMEOUT_MS });
    paths = stdout.split('\0').filter((path) => SOURCE.test(path));
  } catch {
    return { error: 'callers and impact need a git repository: git ls-files failed' };
  }
  const files = [];
  for (const rel of paths) {
    const at = confine(rel);
    if (at.refused) continue;
    let info;
    try {
      info = await lstat(at.path);
    } catch {
      continue;
    }
    if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
    files.push({ rel, text: await readFile(at.path, 'utf8') });
  }
  const known = new Set(files.map((file) => file.rel));
  const importers = new Map();
  const edges = new Map();
  for (const file of files) {
    const targets = new Set();
    for (const match of file.text.matchAll(new RegExp(SPECIFIER.source, 'g'))) {
      const target = resolveSpecifier(file.rel, match[1], known);
      if (target !== null) targets.add(target);
    }
    edges.set(file.rel, targets);
    for (const target of targets) {
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file.rel);
    }
  }
  return { files: files.map((file) => ({ rel: file.rel, lines: file.text.split('\n') })), edges, importers };
}

function resolveSpecifier(fromRel, spec, known) {
  if (!spec.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromRel), spec));
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}/index.js`, `${base}/index.mjs`, `${base}/index.ts`];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

// One pass over every line. A definition line marks its file as defining the name. A call is a name followed by an
// open parenthesis that is not a property access, and a member call is .name( . Calls in a file that imports a
// defining file are marked linked.
function scan(index, name) {
  const escaped = escapeRegex(name);
  const definition = new RegExp(
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?\\s*${escaped}\\b|class\\s+${escaped}\\b|(?:const|let|var)\\s+${escaped}\\b)` +
      `|^\\s*(?:async\\s+)?${escaped}\\s*\\([^)]*\\)\\s*\\{`,
  );
  const direct = new RegExp(`(?<![.\\w$])${escaped}\\s*\\(`);
  const member = new RegExp(`\\.${escaped}\\s*\\(`);
  const defs = [];
  const found = { defs, direct: [], member: [], defining: new Set() };
  for (const file of index.files) {
    file.lines.forEach((text, i) => {
      if (isComment(text)) return;
      if (definition.test(text)) {
        defs.push({ rel: file.rel, line: i + 1, text });
        found.defining.add(file.rel);
        return;
      }
      if (direct.test(text)) found.direct.push({ rel: file.rel, line: i + 1, text, kind: 'direct' });
      else if (member.test(text)) found.member.push({ rel: file.rel, line: i + 1, text, kind: 'member' });
    });
  }
  const importsDefining = (rel) => [...(index.edges.get(rel) ?? [])].some((target) => found.defining.has(target));
  found.direct = found.direct.map((site) => (importsDefining(site.rel) ? { ...site, kind: 'linked' } : site));
  return found;
}

function isComment(text) {
  return /^\s*(?:\/\/|\/\*|\*)/.test(text);
}

function badArgs(name) {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) return 'name must be a JavaScript identifier';
  return null;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(error) {
  return { ok: false, error };
}
