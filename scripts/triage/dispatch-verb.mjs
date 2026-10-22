#!/usr/bin/env node
// Dispatches one spool verb and prints its reply, for live validation of any verb, including ones the
// MCP tool table does not expose (browser, for one). No network and no daemon of its own: the shared daemon
// serves the spool, and it serves only roots that hold a lease, so a cwd without one gets a pinned lease here
// (the form agentplug-runner register_project writes) or a refusal at once.
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
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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

// Spool directories are owner-only (0700) and request and replay files are 0600, because a request body
// can carry session content. An existing directory is tightened too: the daemon may have created it at 0755.
const OWNER_DIR_MODE = 0o700;
const OWNER_FILE_MODE = 0o600;
function ownerDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: OWNER_DIR_MODE });
  fs.chmodSync(dir, OWNER_DIR_MODE);
}

// The daemon's lease for a root is <key>.<pid>.lease holding the root path, where <key> is the first 16 hex of
// sha256(lowercased root) and pid 0 is pinned (LEASE_PINNED_PID in agentplug-runner daemon.rs). A lease for a
// dead pid is removed by the daemon, so only a pinned one survives this process.
const LEASE_PINNED_PID = 0;
function agentplugHome() {
  const over = process.env.AGENTPLUG_HOME?.trim();
  return over ? path.resolve(over) : path.join(os.homedir(), '.agentplug');
}
function hasGitMarker(dir) {
  const marker = path.join(dir, '.git');
  try {
    return fs.statSync(marker).isFile() || fs.existsSync(path.join(marker, 'HEAD'));
  } catch {
    return false;
  }
}
// Mirrors agentplug-host project_root: the nearest ancestor-or-self with a git marker, else the directory itself.
function nearestProjectRoot(dir) {
  for (let current = dir; ; current = path.dirname(current)) {
    if (hasGitMarker(current)) return current;
    if (path.dirname(current) === current) return dir;
  }
}
function pidAlive(pid) {
  if (pid === LEASE_PINNED_PID) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
function attachDaemonLease(cwd) {
  const root = fs.realpathSync(cwd);
  const owner = nearestProjectRoot(root);
  if (owner !== root) {
    console.error(`dispatch-verb: refused ${root}: it lies inside the project ${owner}, and the shared daemon would serve ${owner} for a lease on it, not this spool`);
    process.exit(1);
  }
  const leases = path.join(agentplugHome(), 'leases');
  const key = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
  const held = fs.existsSync(leases) && fs.readdirSync(leases).some((name) => {
    const match = /^([0-9a-f]{16})\.(\d+)\.lease$/.exec(name);
    if (!match || match[1] !== key || !pidAlive(Number(match[2]))) return false;
    try {
      return fs.readFileSync(path.join(leases, name), 'utf8').trim() === root;
    } catch {
      return false;
    }
  });
  if (held) return;
  const file = path.join(leases, `${key}.${LEASE_PINNED_PID}.lease`);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(leases, { recursive: true, mode: OWNER_DIR_MODE });
    fs.writeFileSync(tmp, root, { mode: OWNER_FILE_MODE });
    fs.renameSync(tmp, file);
  } catch (error) {
    console.error(`dispatch-verb: refused ${root}: could not write its daemon lease at ${file}: ${error.message}`);
    process.exit(1);
  }
  console.error(`dispatch-verb: attached ${root} with a pinned daemon lease (${file})`);
}

function dispatch({ verb, cwd, raw, sid }) {
  attachDaemonLease(cwd);
  const spool = path.join(cwd, '.gm', 'exec-spool');
  const inDir = path.join(spool, 'in', verb);
  const outDir = path.join(spool, 'out');
  const replayDir = path.join(spool, 'replay');
  const id = `${sid}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  ownerDir(path.join(cwd, '.gm'));
  ownerDir(spool);
  ownerDir(path.join(spool, 'in'));
  ownerDir(inDir);
  ownerDir(replayDir);
  const ledgerTmp = path.join(replayDir, `.${id}.tmp`);
  // A kv_put body carries the stored value, so its replay record keeps a marker and replay refuses it.
  const redacted = /kv_put/.test(verb);
  const recorded = redacted ? '[REDACTED: kv_put value not recorded]' : raw;
  fs.writeFileSync(ledgerTmp, JSON.stringify({ verb, cwd, sid, raw: recorded, redacted }), { mode: OWNER_FILE_MODE });
  fs.renameSync(ledgerTmp, path.join(replayDir, `${id}.json`));
  const tmp = path.join(inDir, `.${id}.tmp`);
  fs.writeFileSync(tmp, raw, { mode: OWNER_FILE_MODE });
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
  if (record.redacted) {
    console.error(`dispatch-verb: ${originalId} is a ${record.verb} record; its value was not recorded, so it is not replayed`);
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
// A plain-text body (bash, exec_js) carries its session as a leading gm_session_id=<id> line, which the guest
// strips before running the body; an explicit --sid adds that line when the body has none.
function withSessionId(text, id, explicit) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed.session_id ? text : JSON.stringify({ ...parsed, session_id: id });
  }
  if (explicit && !text.startsWith('gm_session_id=')) return `gm_session_id=${id}\n${text}`;
  return text;
}
process.exit(dispatch({ verb, cwd, raw: withSessionId(raw, sid, args.includes('--sid')), sid }).ok ? 0 : 1);
