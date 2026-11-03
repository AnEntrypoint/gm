module.exports = function buildUnits(root) {
  const fs = require('fs');
  const path = require('path');
  const acorn = require(path.join(root, 'node_modules', 'acorn'));
  const files = fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.mjs')).map((f) => 'src/' + f);
  const defs = new Map();
  const dupes = new Set();
  for (const file of files) {
    const ast = acorn.parse(fs.readFileSync(path.join(root, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    for (const node of ast.body) {
      const decl = node.type === 'ExportNamedDeclaration' && node.declaration ? node.declaration : node;
      const items = [];
      if (decl.type === 'FunctionDeclaration' && decl.id) items.push([decl.id.name, decl]);
      if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (d.id.type === 'Identifier' && d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression')) items.push([d.id.name, d.init]);
        }
      }
      for (const [name, fn] of items) {
        if (defs.has(name)) dupes.add(name);
        defs.set(name, { name, file, start: fn.loc.start.line, end: fn.loc.end.line, fn });
      }
    }
  }
  const calls = (node, out) => {
    if (!node || typeof node.type !== 'string') return out;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') out.add(node.callee.name);
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => calls(c, out));
      else if (v && typeof v.type === 'string') calls(v, out);
    }
    return out;
  };
  for (const d of defs.values()) {
    d.cross = [...calls(d.fn, new Set())].filter((n) => defs.has(n) && !dupes.has(n) && n !== d.name && defs.get(n).file !== d.file);
  }
  const units = [...defs.values()].filter((d) => !dupes.has(d.name) && d.cross.length > 0);
  const fileOf = (n) => defs.get(n).file;
  const rel = (p) => (p.startsWith(root + path.sep) ? p.slice(root.length + 1) : p).split(path.sep).join('/');
  const parseHits = (text) => String(text).split('\n').map((l) => l.match(/^(\S+?):(\d+)\s/)).filter(Boolean).map((m) => ({ path: rel(m[1]), line: Number(m[2]) }));
  return { defs, dupes, units, fileOf, parseHits };
};
