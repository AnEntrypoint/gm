#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', b:'\x1b[34m', m:'\x1b[35m', c:'\x1b[36m', d:'\x1b[2m', x:'\x1b[0m', bold:'\x1b[1m' };
const useColor = process.stdout.isTTY;
const col = (k, s) => useColor ? C[k] + s + C.x : s;

function parseDuration(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const mult = { s:1000, m:60000, h:3600000, d:86400000 }[m[2]];
  return n * mult;
}

function parseArgs(argv) {
  const flags = new Set();
  let since = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') { since = parseDuration(argv[++i]); continue; }
    if (a.startsWith('--')) flags.add(a.slice(2));
  }
  return { flags, since };
}

function readLines(p) {
  if (!fs.existsSync(p)) { console.log(col('d', `no log at ${p}`)); return []; }
  try { return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch (e) { console.log(col('r', `read err ${p}: ${e.message}`)); return []; }
}

function collectEvents(sinceMs) {
  const events = [];
  const cutoff = sinceMs ? Date.now() - sinceMs : 0;
  const cwd = process.cwd();
  const wlog = path.join(cwd, '.gm', 'exec-spool', '.watcher.log');
  for (const line of readLines(wlog)) {
    const m = line.match(/evt:\s*(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const ev = JSON.parse(m[1]);
      const ts = typeof ev.ts === 'number' ? ev.ts : Date.parse(ev.ts || '');
      if (ts && ts < cutoff) continue;
      ev._ts = ts || 0; ev._src = 'watcher.log';
      events.push(ev);
    } catch {}
  }
  const gmLogRoots = [
    path.join(os.homedir(), '.gm-log'),
    path.join(os.homedir(), '.claude', 'gm-log'),
  ];
  for (const gmLogRoot of gmLogRoots) {
    if (!fs.existsSync(gmLogRoot)) continue;
    for (const date of fs.readdirSync(gmLogRoot)) {
      const pj = path.join(gmLogRoot, date, 'plugkit.jsonl');
      if (!fs.existsSync(pj)) continue;
      for (const line of readLines(pj)) {
        try {
          const ev = JSON.parse(line);
          const ts = Date.parse(ev.ts || '') || ev.ts || 0;
          if (ts && ts < cutoff) continue;
          ev._ts = ts; ev._src = `gm-log/${date}/plugkit.jsonl`;
          events.push(ev);
        } catch {}
      }
    }
  }
  events.sort((a,b) => (a._ts||0) - (b._ts||0));
  return events;
}

function fmtTs(ts) {
  if (!ts) return '----------';
  return new Date(ts).toISOString().slice(11, 19);
}

function evName(ev) { return ev.event || ''; }

const FILTERS = {
  'embed-failures': ev => /^embed_(fail|init_fail|cached_fail|init_cached_fail)$/.test(evName(ev)),
  'recall-misses': ev => evName(ev) === 'recall' && (ev.hits === 0 || (Array.isArray(ev.results) && ev.results.length === 0)),
  'recall-scores': ev => evName(ev) === 'recall' || evName(ev) === 'recall_score_unavailable',
  'classifier-rejects': ev => evName(ev) === 'memorize_reject',
  'memory-leverage': ev => evName(ev) === 'recall' && (ev.hits > 0 || (Array.isArray(ev.results) && ev.results.length > 0)),
  'recall-modes': ev => evName(ev) === 'recall' && ev.mode,
  'table-drops': ev => evName(ev) === 'table_dropped',
  'discipline-sigil-ignored': ev => evName(ev) === 'discipline_sigil_ignored',
};

function renderEvent(ev, kinds) {
  const t = col('d', fmtTs(ev._ts));
  const name = col('c', evName(ev).padEnd(28));
  const sess = ev.sess ? col('m', `[${String(ev.sess).slice(0,16)}]`) : '';
  const extras = [];
  if (kinds.has('embed-failures') && ev.step) extras.push(`step=${ev.step}`);
  if (ev.error) extras.push(col('r', `err=${String(ev.error).slice(0,80)}`));
  if (ev.reason) extras.push(`reason=${ev.reason}`);
  if (ev.text_prefix) extras.push(col('y', `text="${String(ev.text_prefix).slice(0,40)}"`));
  if (ev.namespace) extras.push(`ns=${ev.namespace}`);
  if (ev.mode) extras.push(col('g', `mode=${ev.mode}`));
  if (ev.derived_query) extras.push(`q="${String(ev.derived_query).slice(0,40)}"`);
  if (typeof ev.hits === 'number') extras.push(`hits=${ev.hits}`);
  if (typeof ev.score === 'number') extras.push(`score=${ev.score.toFixed(3)}`);
  if (ev.sigil) extras.push(col('y', `sigil=@${ev.sigil}`));
  if (ev.key && evName(ev) === 'table_dropped') extras.push(`key=${ev.key}`);
  return `${t} ${name} ${sess} ${extras.join(' ')}`;
}

function summarize(events) {
  const counts = {};
  for (const ev of events) {
    const n = evName(ev) || '(unknown)';
    counts[n] = (counts[n] || 0) + 1;
  }
  return counts;
}

function main() {
  const { flags, since } = parseArgs(process.argv);
  const allEvents = collectEvents(since);
  const activeFilters = [...flags].filter(f => FILTERS[f]);
  const useAll = activeFilters.length === 0;
  const kinds = new Set(activeFilters);
  const matched = useAll ? allEvents : allEvents.filter(ev => activeFilters.some(f => FILTERS[f](ev)));

  console.log(col('bold', `gmsniff — ${matched.length} event(s)${since ? ` in last ${since/1000}s` : ''}${activeFilters.length ? `, filters: ${activeFilters.join(',')}` : ' (all)'}`));
  const counts = summarize(matched);
  const summary = Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([k,v]) => `${col('c',k)}=${v}`).join('  ');
  if (summary) console.log(col('d', 'by event: ') + summary);
  console.log(col('d', '-'.repeat(80)));

  if (kinds.has('recall-modes')) {
    const modeCounts = {};
    for (const ev of matched) if (ev.mode) modeCounts[ev.mode] = (modeCounts[ev.mode] || 0) + 1;
    console.log(col('bold','recall mode distribution:'));
    for (const [m,n] of Object.entries(modeCounts)) console.log(`  ${col('g',m.padEnd(20))} ${n}`);
    console.log();
  }

  for (const ev of matched) console.log(renderEvent(ev, kinds));
}

main();
