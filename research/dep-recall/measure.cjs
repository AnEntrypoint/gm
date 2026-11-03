module.exports = async function measure(gm) {
  const path = require('path');
  const root = path.resolve(__dirname, '..', '..');
  const { defs, dupes, units, fileOf, parseHits } = require('./units.cjs')(root);
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
    return { name: u.name, depFiles: D.size, r10: rec(topFiles(10)), r20: rec(topFiles(20)), r50: rec(topFiles(50)), rExpAll: rec(expAll), rExpOther: rec(expOther), addedAll: expAll.size - topFiles(10).size, addedOther: expOther.size - topFiles(10).size, ok: r.ok !== false };
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
  };
};
