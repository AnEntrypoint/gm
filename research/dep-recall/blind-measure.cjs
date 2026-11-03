const path = require('path');
const fs = require('fs');
const build = require('./units.cjs');
const { REPOS, selectUnits } = require('./blind.cjs');

const DIR = '/tmp/gm-scratch/blind';
const SEARCH_K = 50;
const BATCH = 16;

function descriptionsOf() {
  const map = JSON.parse(fs.readFileSync(path.join(DIR, 'map.json'), 'utf8'));
  const byKey = new Map();
  for (const n of [1, 2, 3]) {
    for (const d of JSON.parse(fs.readFileSync(path.join(DIR, 'desc-' + n + '.json'), 'utf8'))) byKey.set(d.key, d.description);
  }
  return new Map(map.map((m) => [m.tag + ':' + m.file + ':' + m.name, byKey.get(m.key)]));
}

async function scoreOne(gm, x, built, description) {
  const { defs, fileOf, parseHits } = built;
  const unit = x.u;
  const D = new Set(unit.cross.map(fileOf));
  const r = await gm.try(() => gm.search({ query: description, k: SEARCH_K, root: x.root }));
  const hits = parseHits(r.output ?? '');
  const top10 = new Set(hits.slice(0, 10).map((h) => h.path));
  const rec = (set) => [...D].filter((f) => set.has(f)).length / D.size;
  const anchors = (excludeSelf) => {
    const m = new Map();
    for (const h of hits.slice(0, 10)) {
      for (const d of defs.values()) {
        const self = d.name === unit.name && d.file === unit.file;
        if (d.file === h.path && d.start <= h.line && h.line <= d.end && !(excludeSelf && self)) m.set(d.name, d);
      }
    }
    return [...m.values()];
  };
  const expand = (list) => {
    const s = new Set(top10);
    for (const d of list) for (const n of d.cross) s.add(fileOf(n));
    return s;
  };
  const plainAt = (budget) => {
    const s = new Set();
    for (const h of hits) { s.add(h.path); if (s.size >= budget) break; }
    return s;
  };
  const closureAll = expand(anchors(false));
  const closureOther = expand(anchors(true));
  return {
    tag: x.tag, name: unit.name, ok: r.ok !== false,
    plainTop10: rec(top10),
    plainAtAll: rec(plainAt(closureAll.size)),
    plainAtOther: rec(plainAt(closureOther.size)),
    closureAll: rec(closureAll),
    closureOther: rec(closureOther),
    budgetOther: closureOther.size,
    addedOther: closureOther.size - top10.size,
  };
}

module.exports = async function blindMeasure(gm) {
  const descs = descriptionsOf();
  const built = new Map(REPOS.map((r) => [r.tag, build(r.root, r.opts)]));
  const units = selectUnits();
  const keyOf = (x) => x.tag + ':' + x.u.file + ':' + x.u.name;
  const missing = units.filter((x) => !descs.get(keyOf(x)));
  if (missing.length) return { stopped: 'missing descriptions', count: missing.length };
  const rows = [];
  for (let i = 0; i < units.length; i += BATCH) {
    const chunk = units.slice(i, i + BATCH);
    rows.push(...await Promise.all(chunk.map((x) => scoreOne(gm, x, built.get(x.tag), descs.get(keyOf(x))))));
  }
  const f3 = (v) => +v.toFixed(3);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const summarize = (rs) => ({
    units: rs.length,
    failedSearch: rs.filter((r) => !r.ok).length,
    plainTop10: f3(mean(rs.map((r) => r.plainTop10))),
    plainAtBudgetSelfExcluded: f3(mean(rs.map((r) => r.plainAtOther))),
    plainAtBudgetAllAnchors: f3(mean(rs.map((r) => r.plainAtAll))),
    closureSelfExcluded: f3(mean(rs.map((r) => r.closureOther))),
    closureAllAnchors: f3(mean(rs.map((r) => r.closureAll))),
    meanBudgetFilesSelfExcluded: f3(mean(rs.map((r) => r.budgetOther))),
    meanFilesAddedSelfExcluded: f3(mean(rs.map((r) => r.addedOther))),
  });
  return {
    overall: summarize(rows),
    perRepo: REPOS.map((r) => ({ tag: r.tag, ...summarize(rows.filter((x) => x.tag === r.tag)) })),
  };
};
