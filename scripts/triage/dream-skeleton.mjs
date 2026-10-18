#!/usr/bin/env node
// Walking-skeleton check for Dream-RSI: two ordinary dispatches in a fresh session, then
// dream-replay-cycle as that session. Exits 0 only when the cycle answers status replayed and
// .gm/dream-rsi/<sid>/cycle-result.json exists. Usage: node scripts/triage/dream-skeleton.mjs [--cwd <project>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const cwd = path.resolve(args[args.indexOf('--cwd') + 1] && args.indexOf('--cwd') >= 0 ? args[args.indexOf('--cwd') + 1] : process.cwd());
const here = path.dirname(new URL(import.meta.url).pathname);
const sid = 'dream-skel-' + process.pid + '-' + Date.now();

function dispatch(verb, body) {
  const r = spawnSync(process.execPath, [path.join(here, 'dispatch-verb.mjs'), verb, '--cwd', cwd, '--raw', JSON.stringify(body)], { encoding: 'utf8' });
  let reply = null;
  try { reply = JSON.parse(r.stdout); } catch { reply = null; }
  return { code: r.status, reply, stderr: r.stderr.trim() };
}

const steps = [
  dispatch('fs_stat', { session_id: sid, path: 'AGENTS.md' }),
  dispatch('fs_stat', { session_id: sid, path: 'package.json' }),
];
const cycle = dispatch('dream-replay-cycle', { session_id: sid });
const resultPath = path.join(cwd, '.gm', 'dream-rsi', sid, 'cycle-result.json');
const status = cycle.reply?.data?.status ?? cycle.reply?.status ?? null;
const resultExists = fs.existsSync(resultPath);
const pass = steps.every((s) => s.code === 0) && cycle.code === 0 && status === 'replayed' && resultExists;

console.log(JSON.stringify({ session_id: sid, precondition_dispatch_ids: steps.map((s) => s.reply?.dispatch_id ?? null), cycle_dispatch_id: cycle.reply?.dispatch_id ?? null, status, cycle_result: resultExists ? resultPath : null, result: pass ? 'PASS' : 'FAIL' }, null, 2));
process.exit(pass ? 0 : 1);
