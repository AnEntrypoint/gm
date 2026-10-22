#!/usr/bin/env node
// Times one git_push dispatch end to end and prints the wall clock next to the reply's own wait split, so a
// push-latency row is witnessed in one call instead of by hand-assembling a dispatch and grepping its reply.
// The wall clock covers this process: writing the request, the daemon claiming it, the push, and reading the
// reply. The reply's dispatch_waited_ms covers from the request landing to the reply, and dispatch_wait_split
// divides it into admission_ms, claim_wait_ms, exec_ms, daemon_span_ms and reply_poll_ms, so the difference
// between wall and waited is the spool round trip outside the daemon.
//
// Usage: node scripts/triage/push-timing.mjs [--cwd <repo>] [--rev <sha>] [--sid <id>] [--timeout-ms <ms>]
//                                            [--body <extra-json-object>]
//
// --body merges into the request body, so push flags such as recover_remote_moved and allow_foreign_commits
// (both body-only) can be passed; --rev always wins. Exit 0 when the reply has ok: true, else 1.
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
const cwd = path.resolve(flag('--cwd', process.cwd()));
const rev = flag('--rev', 'HEAD');
const sid = flag('--sid', `push-timing-${process.pid}`);
const timeoutMs = flag('--timeout-ms', '300000');
const extra = flag('--body', '');

const body = { rev };
if (extra) {
  const parsed = JSON.parse(extra);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('--body must be a JSON object');
  Object.assign(body, parsed);
  body.rev = rev;
}

const started = Date.now();
const child = spawnSync(process.execPath, [dispatchVerb, 'git_push', '--cwd', cwd, '--raw', JSON.stringify(body), '--sid', sid, '--timeout-ms', String(timeoutMs)], { encoding: 'utf8' });
const wallMs = Date.now() - started;

const stdout = (child.stdout ?? '').trim();
const first = stdout.split('\n')[0] ?? '';
let reply = null;
try {
  reply = JSON.parse(first);
} catch {
  reply = null;
}

console.log(`verb: git_push`);
console.log(`rev: ${rev}`);
console.log(`cwd: ${cwd}`);
console.log(`dispatch_id: ${reply?.dispatch_id ?? ''}`);
console.log(`wall_ms: ${wallMs}`);
const answered = /answered in ([0-9]+)ms/.exec(child.stderr ?? '');
console.log(`spool_latency_ms: ${answered ? answered[1] : ''}`);
console.log(`dispatch_waited_ms: ${reply?.dispatch_waited_ms ?? ''}`);
console.log(`guest_duration_ms: ${reply?.duration_ms ?? ''}`);
const split = reply?.dispatch_wait_split;
if (split && typeof split === 'object') {
  for (const [k, v] of Object.entries(split)) console.log(`split.${k}: ${v}`);
  const waited = Number(reply.dispatch_waited_ms);
  if (Number.isFinite(waited)) console.log(`outside_daemon_ms: ${Math.max(0, wallMs - waited)}`);
} else {
  console.log('split: none (the wait was under the 250 ms disclosure floor, or the reply carries no split)');
}
console.log(`ok: ${reply?.ok ?? false}`);
if (reply?.error_code) console.log(`error_code: ${reply.error_code}`);
if (reply?.error) console.log(`error: ${String(reply.error).split('\n')[0]}`);
console.log(`data: ${reply ? JSON.stringify(reply.data ?? null).slice(0, 600) : stdout.slice(0, 600)}`);
process.exit(reply?.ok === true ? 0 : 1);
