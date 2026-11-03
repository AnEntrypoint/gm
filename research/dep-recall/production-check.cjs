const path = require('path');
const fs = require('fs');
const build = require('./units.cjs');
const { REPOS, selectUnits } = require('./blind.cjs');

const DIR = path.join(__dirname, 'blind');

function descriptionsOf() {
  const map = JSON.parse(fs.readFileSync(path.join(DIR, 'units-map.json'), 'utf8'));
  const byKey = new Map();
  for (const n of [1, 2, 3]) {
    for (const d of JSON.parse(fs.readFileSync(path.join(DIR, 'desc-' + n + '.json'), 'utf8'))) byKey.set(d.key, d.description);
  }
  return new Map(map.map((m) => [m.tag + ':' + m.file + ':' + m.name, byKey.get(m.key)]));
}

async function productionCheck() {
  const { createSearchVerbs } = await import(path.join(__dirname, '..', '..', 'src', 'search.mjs'));
  const descs = descriptionsOf();
  const verbs = new Map(REPOS.map((r) => [r.tag, createSearchVerbs({ root: r.root, confine: null })]));
  const built = new Map(REPOS.map((r) => [r.tag, build(r.root, r.opts)]));
  const rows = [];
  const described = selectUnits().filter((u) => descs.get(u.tag + ':' + u.u.file + ':' + u.u.name) !== undefined);
  for (const x of described) {
    const repo = REPOS.find((r) => r.tag === x.tag);
    const { fileOf } = built.get(x.tag);
    const D = new Set(x.u.cross.map(fileOf));
    const query = descs.get(x.tag + ':' + x.u.file + ':' + x.u.name);
    const reply = await verbs.get(x.tag).search({ query, k: 50, closure: true });
    const rel = (p) => (p.startsWith(repo.root + path.sep) ? p.slice(repo.root.length + 1) : p).split(path.sep).join('/');
    const parsed = String(reply.output ?? '').split('\n').map((line) => line.match(/^(\S+?):(\d+) (\S+) /)).filter(Boolean).map((m) => ({ file: rel(m[1]), closure: m[3] === 'closure' }));
    const scored = parsed.filter((p) => !p.closure);
    const top10 = new Set(scored.slice(0, 10).map((p) => p.file));
    const closureFiles = new Set(parsed.filter((p) => p.closure).map((p) => p.file));
    const files = new Set([...top10, ...closureFiles]);
    const plain = new Set();
    for (const p of scored) {
      plain.add(p.file);
      if (plain.size >= files.size) break;
    }
    const rec = (set) => [...D].filter((f) => set.has(f)).length / D.size;
    rows.push({ tag: x.tag, plainAtBudget: rec(plain), closure: rec(files), budget: files.size, added: closureFiles.size });
  }
  const f3 = (v) => +v.toFixed(3);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const summarize = (rs) => ({
    units: rs.length,
    plainAtBudget: f3(mean(rs.map((r) => r.plainAtBudget))),
    closureProduction: f3(mean(rs.map((r) => r.closure))),
    meanBudgetFiles: f3(mean(rs.map((r) => r.budget))),
    meanFilesAdded: f3(mean(rs.map((r) => r.added))),
  });
  return { skippedNoDescription: selectUnits().length - described.length, overall: summarize(rows), perRepo: REPOS.map((r) => ({ tag: r.tag, ...summarize(rows.filter((x) => x.tag === r.tag)) })) };
}

module.exports = productionCheck;

if (require.main === module) {
  productionCheck().then((result) => console.log(JSON.stringify(result)));
}
