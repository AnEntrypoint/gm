#!/usr/bin/env node
// Waits for the CI of one commit and prints the run id as soon as the run reaches a conclusion. A push is not
// done until its CI is read, and ci-status answers one sample per call, so this polls ci-status through the same
// spool dispatch-verb.mjs uses and stops at the first non-pending run_status.
//
// Usage: node scripts/triage/ci-watch.mjs [--cwd <repo>] [--sid <id>] [--every <sec>] [--minutes <n>] <full-sha>
//
// The sha must be the full 40-char one: ci-status matches a run by its head sha, and a short one matches nothing.
// Output: one line per sample (elapsed, run_status, pending_count, run ids), then a final line with the verdict.
// Exit 0 on success or no_applicable_workflow, 1 on failure, 2 when the budget ran out with the run still pending.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatchVerb = path.join(here, 'dispatch-verb.mjs');

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--cwd' || a === '--sid' || a === '--every' || a === '--minutes') { i += 1; continue; }
  if (a.startsWith('--')) continue;
  positional.push(a);
}
const sha = positional[0];
const cwd = path.resolve(flag('--cwd', process.cwd()));
const sid = flag('--sid', `ci-watch-${process.pid}`);
const everyMs = Math.max(10_000, Number(flag('--every', '45')) * 1000);
const budgetMs = Math.max(everyMs, Number(flag('--minutes', '20')) * 60_000);

if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
  console.error(`usage: ci-watch.mjs [--cwd <repo>] [--sid <id>] [--every <sec>] [--minutes <n>] <full-40-char-sha>`);
  process.exit(2);
}

const started = Date.now();
let last = null;
for (;;) {
  const child = spawnSync(process.execPath, [dispatchVerb, 'ci-status', '--cwd', cwd, '--raw', JSON.stringify({ sha }), '--sid', sid], { encoding: 'utf8', timeout: 180_000 });
  const first = (child.stdout ?? '').trim().split('\n')[0] ?? '';
  let reply = null;
  try {
    reply = JSON.parse(first);
  } catch {
    reply = null;
  }
  const data = reply?.data ?? null;
  const status = data?.run_status ?? (reply?.ok === false ? `dispatch_failed: ${reply?.error_code ?? 'unknown'}` : 'unknown');
  const pending = data?.pending_count ?? 0;
  const runs = (data?.failing_jobs ?? []).map((j) => j.run_id).concat(data?.run_id ? [data.run_id] : []);
  const runIds = [...new Set(runs.filter(Boolean))].join(',') || (data?.run_ids ?? []).join?.(',') || '';
  const runUrl = data?.run_url ?? (data?.failing_runs ?? []).map((r) => r.run_url).join(',') ?? '';
  last = { status, pending, runIds, data };
  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`t+${elapsed}s run_status=${status} pending=${pending} run_id=${runIds} run_url=${runUrl}`);
  if (status === 'success' || status === 'failure' || status === 'no_applicable_workflow') break;
  if (Date.now() - started >= budgetMs) {
    console.log(`budget of ${Math.round(budgetMs / 60_000)} min exhausted with run_status=${status}; read it again with ci-status {sha:"${sha}"}`);
    process.exit(2);
  }
  await new Promise((r) => setTimeout(r, everyMs));
}

const failing = (last.data?.failing_jobs ?? []).map((j) => `${j.name} (job ${j.job_id}, run ${j.run_id})`);
console.log(`verdict: ${last.status} for ${sha}`);
if (failing.length) console.log(`failing_jobs: ${failing.join('; ')}`);
process.exit(last.status === 'failure' ? 1 : 0);
