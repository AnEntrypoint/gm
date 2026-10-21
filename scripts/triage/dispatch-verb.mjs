#!/usr/bin/env node
// Dispatches one spool verb and prints its reply, for live validation of any verb, including ones the
// MCP tool table does not expose (browser, for one). Local spool only: no network, no daemon of its own.
//
// Usage: node scripts/triage/dispatch-verb.mjs <verb> [--cwd <project>] [--raw <text> | --body-file <path>]
//                                              [--sid <id>] [--timeout-ms <ms>]
//        node scripts/triage/dispatch-verb.mjs replay <dispatch-id> [--timeout-ms <ms>]
//
// --sid defaults to the JSON body's session_id, since the spool refuses a task id that does not start
// with the declared session (session_id_task_mismatch).
//
// The body goes to .gm/exec-spool/in/<verb>/<N>.txt, written atomically. The reply is read from
// out/<verb>-<N>.json once its .ready marker exists. Exit 0 when the reply has ok: true, else 1.
// Latency (request to reply) is printed to stderr.
//
// Each request is also recorded in .gm/exec-spool/replay/<N>.json (verb, cwd, raw body), because the
// spool consumes its in/ and out/ files. `replay <N>` re-dispatches that record and prints both ids.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const verb = args[0];
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const timeoutMs = Number(flag('--timeout-ms', '150000'));

function bodySessionId(text) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.session_id === 'string' && parsed.session_id ? parsed.session_id : null;
  } catch {
    return null;
  }
}

function dispatch({ verb, cwd, raw, sid }) {
  const spool = path.join(cwd, '.gm', 'exec-spool');
  const inDir = path.join(spool, 'in', verb);
  const outDir = path.join(spool, 'out');
  const replayDir = path.join(spool, 'replay');
  const id = `${sid}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  fs.mkdirSync(inDir, { recursive: true });
  fs.mkdirSync(replayDir, { recursive: true });
  const ledgerTmp = path.join(replayDir, `.${id}.tmp`);
  fs.writeFileSync(ledgerTmp, JSON.stringify({ verb, cwd, sid, raw }));
  fs.renameSync(ledgerTmp, path.join(replayDir, `${id}.json`));
  const tmp = path.join(inDir, `.${id}.tmp`);
  fs.writeFileSync(tmp, raw);
  const started = Date.now();
  fs.renameSync(tmp, path.join(inDir, `${id}.txt`));

  const replyPath = path.join(outDir, `${verb}-${id}.json`);
  const readyPath = `${replyPath}.ready`;
  const deadline = started + timeoutMs;
  while (!fs.existsSync(readyPath)) {
    if (Date.now() >= deadline) {
      console.error(`dispatch-verb: no reply for ${verb} ${id} within ${timeoutMs}ms (request left in ${inDir})`);
      process.exit(1);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  const latencyMs = Date.now() - started;
  const reply = fs.readFileSync(replyPath, 'utf8');
  process.stdout.write(reply.endsWith('\n') ? reply : reply + '\n');
  console.error(`dispatch-verb: ${verb} ${id} answered in ${latencyMs}ms`);
  let ok = false;
  try {
    ok = JSON.parse(reply).ok === true;
  } catch {
    ok = false;
  }
  return { id, ok };
}

if (verb === 'replay') {
  const originalId = args[1];
  if (!originalId || originalId.startsWith('--')) {
    console.error('usage: dispatch-verb.mjs replay <dispatch-id> [--timeout-ms <ms>]');
    process.exit(2);
  }
  const ledgerPath = path.join(path.resolve(process.cwd()), '.gm', 'exec-spool', 'replay', `${originalId}.json`);
  let record;
  try {
    record = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch {
    console.error(`dispatch-verb: no replay record for ${originalId} at ${ledgerPath} (recorded only for dispatch-verb requests)`);
    process.exit(1);
  }
  console.error(`dispatch-verb: replaying ${record.verb} ${originalId} in ${record.cwd}`);
  const { id, ok } = dispatch({ ...record, sid: flag('--sid', record.sid) });
  console.error(`dispatch-verb: original ${originalId} replayed as ${id}`);
  process.exit(ok ? 0 : 1);
}

if (!verb || verb.startsWith('--')) {
  console.error('usage: dispatch-verb.mjs <verb> [--cwd <project>] [--raw <text> | --body-file <path>] [--sid <id>] [--timeout-ms <ms>]');
  process.exit(2);
}
const cwd = path.resolve(flag('--cwd', process.cwd()));
const bodyFile = flag('--body-file', null);
const raw = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : flag('--raw', null);
if (raw === null) {
  console.error('dispatch-verb: give --raw <text> or --body-file <path>');
  process.exit(2);
}
const sid = flag('--sid', bodySessionId(raw) ?? 'validate-' + process.pid);
// The ledger records a witness's session from the body's session_id only. A --sid alone left it null, and
// prd-resolve then refused the witness as a self-witness, so a JSON body without session_id gets --sid.
function withSessionId(text, id) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !parsed.session_id) {
      return JSON.stringify({ ...parsed, session_id: id });
    }
  } catch {
    // not JSON: sent unchanged
  }
  return text;
}
process.exit(dispatch({ verb, cwd, raw: withSessionId(raw, sid), sid }).ok ? 0 : 1);
