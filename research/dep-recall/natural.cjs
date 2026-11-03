module.exports = async function natural(gm) {
  const path = require('path');
  const root = path.resolve(__dirname, '..', '..');
  const { units, fileOf, parseHits, defs } = require('./units.cjs')(root);
  const DESC = {
    runOnce: 'Runs one scripted task as a separate process in a chosen workspace with a fixed model script and latency, then reads the events of that run and returns when it started and ended.',
    replay: 'Replays an earlier finished run from the model replies it recorded, checks the saved workspace folder, and starts a new run from those replies.',
    events: 'Prints the queued pending events once and clears them, or waits for new events to arrive and prints them, stopping on a timeout or a process signal.',
    eventsDir: 'Works out which run folder the events command should read, from an explicit folder or from a run identifier, and fails when that folder does not exist.',
    query: 'Runs a filter expression over the recorded log of one run and prints the result, refusing when the run has no log or the filter fails.',
    doctor: 'Health report that checks the Node version, whether the workspace is writable, the most recent run, and the registration of the server.',
    lastRunSummary: 'Finds the most recent run folder among the runs directories and summarizes its final recorded event.',
    createFetchVerbs: 'Builds the web fetch tool with a timeout, retries transient network failures, and keeps a copy of each fetched source.',
    classify: 'Maps a fetch result to an error category, using the HTTP status for a successful request and the error code for a failed one.',
    runGate: 'Runs every commit check on the checkout (syntax, ASCII text, documentation paths, source archives, the wiki, skill files, server connection, workers, prompts and a smoke run) and reports each result.',
    syntaxCheck: 'Checks that every tracked module parses by running a syntax check on each one in parallel, and lists the files that fail.',
    promptCheck: 'Opens a throwaway server session with the default servers turned off, requests the prompt list, and checks the answer.',
    smokeCheck: 'Runs a smoke task and a control task in scratch folders, and checks that the smoke run succeeds while the control run stops after one step.',
    commitExists: 'Checks that a commit identifier exists in the repository and points at a commit rather than a tree or a blob.',
    createGitVerbs: 'Builds the git tool set for the workspace (status, add, commit, push and the rest), retries network operations, and runs the commit gate before any commit.',
  };
  const sorted = units.slice().sort((a, b) => (a.file + ':' + String(a.start).padStart(5, '0')).localeCompare(b.file + ':' + String(b.start).padStart(5, '0')));
  const chosen = sorted.slice(0, 15);
  if (!chosen.every((u) => Object.prototype.hasOwnProperty.call(DESC, u.name))) return { error: 'description missing for a chosen unit', names: chosen.map((u) => u.name) };
  const f3 = (x) => +x.toFixed(3);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const rows = await Promise.all(chosen.map(async (u) => {
    const D = new Set(u.cross.map(fileOf));
    const r = await gm.try(() => gm.search({ query: DESC[u.name], k: 50, root }));
    const hits = parseHits(r.output ?? '');
    const top10 = new Set(hits.slice(0, 10).map((h) => h.path));
    const anchors = new Map();
    for (const h of hits.slice(0, 10)) {
      for (const d of defs.values()) {
        if (d.file === h.path && d.start <= h.line && h.line <= d.end) anchors.set(d.name, d);
      }
    }
    const closure = new Set(top10);
    for (const d of anchors.values()) for (const n of d.cross) closure.add(fileOf(n));
    const budget = closure.size;
    const plain = new Set();
    for (const h of hits) {
      plain.add(h.path);
      if (plain.size >= budget) break;
    }
    const rec = (set) => [...D].filter((f) => set.has(f)).length / D.size;
    return { name: u.name, hits: hits.length, budget, plainTop10: rec(top10), plainAtBudget: rec(plain), closure: rec(closure), closureAdded: closure.size - top10.size };
  }));
  return {
    chosen: rows.length,
    meanPlainTop10: f3(mean(rows.map((r) => r.plainTop10))),
    meanPlainAtBudget: f3(mean(rows.map((r) => r.plainAtBudget))),
    meanClosure: f3(mean(rows.map((r) => r.closure))),
    meanBudgetFiles: f3(mean(rows.map((r) => r.budget))),
    meanClosureAdded: f3(mean(rows.map((r) => r.closureAdded))),
    perUnit: rows.map((r) => ({ name: r.name, plainAtBudget: f3(r.plainAtBudget), closure: f3(r.closure), budget: r.budget })),
  };
};
