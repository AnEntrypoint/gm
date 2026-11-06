import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { resultZone1 } from './compact.mjs';

const execFileAsync = promisify(execFile);
let acornParse = null;
function parseSource(text, options) {
  acornParse ??= createRequire(import.meta.url)('acorn').parse;
  return acornParse(text, options);
}
const SOURCE = /\.(?:js|mjs|cjs|ts)$/;
const MAX_FILE_BYTES = 1000000;
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const LIST_TIMEOUT_MS = 30000;
const OUTPUT_PAGE = 20000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 5;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const KEYWORDS = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']);
const NOTE = 'Exact for parsed JavaScript: a call is a call expression whose callee is the name, or a member call .name(). Not resolved: shadowing, aliases and dynamic calls. A TypeScript file, or one that does not parse, is scanned by lines and marked approximate.';
const LINE_DEF = /\b(?:function|class)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
const LINE_CALL = /(\.)?\b([A-Za-z_$][\w$]*)\s*\(/g;
const LINE_SPEC = /\bfrom\s+['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const CODE_TOOLS = [
  {
    name: 'callers',
    description: 'Call sites of an identifier in the tracked and untracked .js, .mjs, .cjs and .ts files, as path:line [kind] text. kind is linked (a direct call in a file that imports a defining file), direct, or member (.name(). Exact for parsed JavaScript; TypeScript and files that do not parse are scanned by lines and marked. limit is 1 to 1000, default 100.',
    inputSchema: obj({ name: str, limit: num }, ['name']),
  },
  {
    name: 'impact',
    description: 'The files that define an identifier, the files that call it, and the files that import those, out to depth levels (default 2, max 5). Import edges come from parsed JavaScript and resolve inside the repository. Approximate where a file is scanned by lines.',
    inputSchema: obj({ name: str, depth: num }, ['name']),
  },
];

export const COMPACT = {
  tools: {
    callers: { zone1: resultZone1, zone2: () => null },
    impact: { zone1: resultZone1, zone2: () => null },
  },
};

export function createAstVerbs({ root, confine }) {
  const cache = new Map();
  return {
    async callers({ name, limit = DEFAULT_LIMIT }) {
      const bad = badName(name);
      if (bad) return fail(bad);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return fail(`limit must be an integer from 1 to ${MAX_LIMIT}`);
      const index = await loadIndex(root, confine, cache);
      if (index.error) return fail(index.error);
      const { sites } = scan(index.files, name);
      const shown = sites.slice(0, limit).map((site) => `${site.rel}:${site.line} [${site.kind}] ${site.text.trim()}`);
      return { ok: true, output: [...shown, `(${sites.length} call sites in ${index.files.length} files; ${NOTE})`].join('\n').slice(0, OUTPUT_PAGE) };
    },

    async impact({ name, depth = DEFAULT_DEPTH }) {
      const bad = badName(name);
      if (bad) return fail(bad);
      if (!Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) return fail(`depth must be an integer from 0 to ${MAX_DEPTH}`);
      const index = await loadIndex(root, confine, cache);
      if (index.error) return fail(index.error);
      const found = impactOf(index.files, name, depth);
      const lines = [
        `impact of ${name}: ${found.defs.length} defining file(s), ${found.callFiles.length} calling file(s)`,
        `defines: ${found.defs.join(', ') || '(none)'}`,
        `calls: ${found.callFiles.join(', ') || '(none)'}`,
        ...found.importers.map((files, i) => `importers at depth ${i + 1}: ${files.join(', ') || '(none)'}`),
        `(${NOTE})`,
      ];
      return { ok: true, output: lines.join('\n').slice(0, OUTPUT_PAGE) };
    },
  };
}

function badName(name) {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) return 'name must be a JavaScript identifier';
  if (KEYWORDS.has(name)) return `${name} is a JavaScript keyword, so it has no callers to list`;
  return null;
}

function fail(error) {
  return { ok: false, error };
}

async function loadIndex(root, confine, cache) {
  let listed;
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: MAX_LIST_BYTES, timeout: LIST_TIMEOUT_MS });
    listed = stdout.split('\0').filter((path) => SOURCE.test(path) && !path.startsWith('vendor/'));
  } catch {
    return { error: 'callers and impact need a git repository: git ls-files failed' };
  }
  const files = [];
  for (const rel of listed) {
    const at = confine(rel);
    if (at.refused) continue;
    let info;
    try {
      info = await lstat(at.path);
    } catch {
      continue;
    }
    if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
    const sig = `${info.mtimeMs}:${info.size}`;
    let entry = cache.get(rel);
    if (!entry || entry.sig !== sig) {
      entry = analyse(rel, await readFile(at.path, 'utf8'));
      entry.sig = sig;
      cache.set(rel, entry);
    }
    files.push(entry);
  }
  const present = new Set(files.map((entry) => entry.rel));
  for (const rel of [...cache.keys()]) if (!present.has(rel)) cache.delete(rel);
  for (const entry of files) entry.edges = entry.specs.map((spec) => resolveSpec(entry.rel, spec, present)).filter((to) => to !== null);
  return { files };
}

function analyse(rel, text) {
  const entry = { rel, lines: text.split('\n'), defs: new Set(), calls: new Map(), specs: [], approximate: false, edges: [] };
  const tree = rel.endsWith('.ts') ? null : parseJs(text);
  if (tree === null) {
    entry.approximate = true;
    scanLines(entry);
    return entry;
  }
  const starts = lineStarts(text);
  walk(tree, (node) => collect(entry, node, starts));
  return entry;
}

function parseJs(text) {
  for (const sourceType of ['module', 'script']) {
    try {
      return parseSource(text, { ecmaVersion: 'latest', sourceType, allowHashBang: true });
    } catch {
    }
  }
  return null;
}

function walk(root, visit) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    visit(node);
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) if (child !== null && typeof child.type === 'string') stack.push(child);
      } else if (value !== null && typeof value === 'object' && typeof value.type === 'string') {
        stack.push(value);
      }
    }
  }
}

function collect(entry, node, starts) {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      if (node.id) entry.defs.add(node.id.name);
      break;
    case 'VariableDeclarator':
      if (node.id.type === 'Identifier') entry.defs.add(node.id.name);
      break;
    case 'MethodDefinition':
      if (!node.computed && node.key.type === 'Identifier') entry.defs.add(node.key.name);
      break;
    case 'Property':
      if (!node.computed && node.key.type === 'Identifier' && (node.method || node.value.type === 'FunctionExpression' || node.value.type === 'ArrowFunctionExpression')) entry.defs.add(node.key.name);
      break;
    case 'ImportDeclaration':
    case 'ExportAllDeclaration':
      entry.specs.push(node.source.value);
      break;
    case 'ExportNamedDeclaration':
      if (node.source) entry.specs.push(node.source.value);
      break;
    case 'ImportExpression':
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') entry.specs.push(node.source.value);
      break;
    case 'CallExpression': {
      const line = lineAt(starts, node.start);
      const { callee } = node;
      if (callee.type === 'Identifier') {
        const first = node.arguments[0];
        if (callee.name === 'require' && first?.type === 'Literal' && typeof first.value === 'string') entry.specs.push(first.value);
        recordCall(entry, callee.name, line, false);
      } else if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        recordCall(entry, callee.property.name, line, true);
      }
      break;
    }
    default:
      break;
  }
}

function recordCall(entry, name, line, member) {
  if (!entry.calls.has(name)) entry.calls.set(name, []);
  entry.calls.get(name).push({ line, member });
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function scanLines(entry) {
  entry.lines.forEach((text, index) => {
    if (text.trim().startsWith('//')) return;
    const defined = new Set();
    for (const match of text.matchAll(LINE_DEF)) {
      const name = match[1] ?? match[2];
      defined.add(name);
      entry.defs.add(name);
    }
    for (const match of text.matchAll(LINE_CALL)) {
      const name = match[2];
      if (KEYWORDS.has(name) || defined.has(name)) continue;
      recordCall(entry, name, index + 1, match[1] === '.');
    }
    for (const match of text.matchAll(LINE_SPEC)) entry.specs.push(match[1] ?? match[2] ?? match[3]);
  });
}

function resolveSpec(from, spec, present) {
  if (!spec.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}/index.js`, `${base}/index.mjs`, `${base}/index.ts`];
  return candidates.find((candidate) => present.has(candidate)) ?? null;
}

function scan(files, name) {
  const defs = new Set();
  for (const entry of files) if (entry.defs.has(name)) defs.add(entry.rel);
  const callFiles = new Set();
  const sites = [];
  for (const entry of files) {
    const calls = entry.calls.get(name);
    if (!calls) continue;
    callFiles.add(entry.rel);
    const linked = entry.edges.some((to) => defs.has(to));
    for (const call of calls) {
      const kind = call.member ? 'member' : linked ? 'linked' : 'direct';
      sites.push({ rel: entry.rel, line: call.line, kind: entry.approximate ? `${kind}, line scan` : kind, text: entry.lines[call.line - 1] ?? '' });
    }
  }
  sites.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
  return { defs, callFiles, sites };
}

function impactOf(files, name, depth) {
  const { defs, callFiles } = scan(files, name);
  const reached = new Set([...defs, ...callFiles]);
  const importers = [];
  let frontier = new Set(reached);
  for (let level = 1; level <= depth && frontier.size > 0; level += 1) {
    const next = files.filter((entry) => !reached.has(entry.rel) && entry.edges.some((to) => frontier.has(to))).map((entry) => entry.rel).sort();
    for (const rel of next) reached.add(rel);
    importers.push(next);
    frontier = new Set(next);
  }
  return { defs: [...defs].sort(), callFiles: [...callFiles].sort(), importers };
}
