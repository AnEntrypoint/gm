module.exports = async function measure(gm) {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..', '..');
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
  const rows = await Promise.all(units.map(async (u) => {
    const D = new Set(u.cross.map(fileOf));
    const r = await gm.try(() => gm.search({ query: u.name, k: 50, root }));
    const hits = parseHits(r.output ?? '');
    const topFiles = (k) => new Set(hits.slice(0, k).map((h) => h.path));
    const rec = (set) => [...D].filter((f) => set.has(f)).length / D.size;
    const anchors = (excludeSelf) => {
      const m = new Map();
      for (const h of hits.slice(0, 10)) {
        for (const d of defs.values()) {
          if (d.file === h.path && d.start <= h.line && h.line <= d.end && !(excludeSelf && d.name === u.name)) m.set(d.name, d);
        }
      }
      return [...m.values()];
    };
    const expand = (list) => {
      const s = new Set(topFiles(10));
      for (const d of list) for (const n of d.cross) s.add(fileOf(n));
      return s;
    };
    const expAll = expand(anchors(false));
    const expOther = expand(anchors(true));
    return { name: u.name, depFiles: D.size, hits: hits.length, r10: rec(topFiles(10)), r20: rec(topFiles(20)), r50: rec(topFiles(50)), rExpAll: rec(expAll), rExpOther: rec(expOther), addedAll: expAll.size - topFiles(10).size, addedOther: expOther.size - topFiles(10).size, ok: r.ok !== false };
  }));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const f3 = (x) => +x.toFixed(3);
  return {
    units: rows.length,
    dupesExcluded: dupes.size,
    searchFailed: rows.filter((r) => !r.ok).length,
    plainRecall: { top10: f3(mean(rows.map((r) => r.r10))), top20: f3(mean(rows.map((r) => r.r20))), top50: f3(mean(rows.map((r) => r.r50))) },
    closureAllAnchors: { recall: f3(mean(rows.map((r) => r.rExpAll))), meanFilesAdded: f3(mean(rows.map((r) => r.addedAll))) },
    closureOtherAnchors: { recall: f3(mean(rows.map((r) => r.rExpOther))), meanFilesAdded: f3(mean(rows.map((r) => r.addedOther))) },
    lowestPlain: rows.slice().sort((a, b) => a.r10 - b.r10).slice(0, 3).map((r) => ({ name: r.name, r10: f3(r.r10), depFiles: r.depFiles })),
  };
};
