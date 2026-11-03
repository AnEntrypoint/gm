import { parse } from 'acorn';

const JS_FILE = /\.(m?js|cjs)$/;
const parsed = new Map();

export function closureLines(entries, hits, { shownAt, snippet }, anchors = 10, cap = 20) {
  const defs = new Map();
  const dupes = new Set();
  for (const entry of entries) {
    for (const def of defsOf(entry)) {
      if (defs.has(def.name)) dupes.add(def.name);
      defs.set(def.name, def);
    }
  }
  const top = new Set(hits.slice(0, anchors).map((hit) => hit.doc.path));
  const anchored = new Map();
  for (const hit of hits.slice(0, anchors)) {
    for (const def of defs.values()) {
      if (def.file === hit.doc.path && def.start <= hit.doc.line && hit.doc.line <= def.end) anchored.set(def.name, def);
    }
  }
  const picked = new Map();
  for (const def of anchored.values()) {
    for (const name of def.callees) {
      const target = defs.get(name);
      if (target === undefined || dupes.has(name) || name === def.name || target.file === def.file) continue;
      if (top.has(target.file) || picked.has(target.file)) continue;
      picked.set(target.file, target);
    }
  }
  const linesOf = new Map(entries.map((entry) => [entry.rel, entry.lines]));
  return [...picked.values()]
    .slice(0, cap)
    .map((target) => `${shownAt(target.file)}:${target.start} closure ${snippet(linesOf.get(target.file)[target.start - 1].text)}`);
}

function defsOf(entry) {
  if (!JS_FILE.test(entry.rel)) return [];
  const known = parsed.get(entry.rel);
  if (known !== undefined && known.digest === entry.digest) return known.defs;
  const defs = parseDefs(entry);
  parsed.set(entry.rel, { digest: entry.digest, defs });
  return defs;
}

function parseDefs(entry) {
  let program;
  try {
    program = parse(entry.lines.map((line) => line.text).join('\n'), { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch {
    return [];
  }
  const defs = [];
  for (const statement of program.body) {
    const node = statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement;
    for (const [name, fn] of functionsOf(node)) {
      defs.push({ name, file: entry.rel, start: fn.loc.start.line, end: fn.loc.end.line, callees: calleesOf(fn, new Set()) });
    }
  }
  return defs;
}

function functionsOf(node) {
  if (node.type === 'FunctionDeclaration' && node.id) return [[node.id.name, node]];
  if (node.type !== 'VariableDeclaration') return [];
  return node.declarations
    .filter((declarator) => declarator.id.type === 'Identifier' && declarator.init && (declarator.init.type === 'ArrowFunctionExpression' || declarator.init.type === 'FunctionExpression'))
    .map((declarator) => [declarator.id.name, declarator.init]);
}

function calleesOf(node, out) {
  if (!node || typeof node.type !== 'string') return out;
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') out.add(node.callee.name);
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => calleesOf(child, out));
    else if (value && typeof value.type === 'string') calleesOf(value, out);
  }
  return out;
}
