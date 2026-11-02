// Updates from the repository. A checkout of gm-new is a clone of origin main, so an update is a fast-forward pull. A check fetches origin.
// When main is ahead, the gate runs on the new commit first, in a clone of the checkout at that commit, so a commit the gate rejects never
// reaches the checkout. The pull waits while a tool call, a body or a job is running, and it never runs in a checkout with changes to tracked
// files. Then the checkout is fast-forwarded and npm ci runs when the lock file changed. A pull that changes src/ or skills/ restarts the
// worker, and the check waits for the restart: when the worker does not start on the new code, the pull is rolled back, the checkout is
// reset to the commit before it, the worker starts on the old code, and the rollback is logged. A diverged history is reported and left
// alone. A check that cannot reach origin is reported and skipped. The checks never throw. A pull that changes tools/, other than the relay
// (tools/relay.mjs), replaces the core: replaceCore starts the new core, and when that core does not take over, the pull is rolled back.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
// A push to origin reaches a running checkout within one check. The check is a fetch of origin, which changes nothing when origin has not moved.
export const DEFAULT_UPDATE_MS = 60000;
const FIRST_CHECK_MS = 30000;
const SHORT_MS = 10000;
const FETCH_MS = 60000;
const PULL_MS = 60000;
const INSTALL_MS = 600000;
const GATE_MS = 600000;
// How long the check waits for the supervisor to report the worker's start after a pull or a rollback, and how soon a waiting pull is retried.
const WORKER_MS = 60000;
const WAIT_RETRY_MS = 60000;
// The targets that were refused by the gate or rolled back, with the reason. Until origin moves to another commit, a refused target is not
// tried again, so a broken commit on main is not pulled, failed and rolled back at every check.
const refused = new Map();

const firstLine = (err) => String(err?.stderr || err?.message || err).split('\n').find((line) => line.trim() !== '') ?? 'unknown error';
const short = (sha) => sha.slice(0, 7);

function git(root, args, timeout = SHORT_MS) {
  return run('git', args, { cwd: root, timeout, maxBuffer: 16 * 1024 * 1024 }).then((out) => out.stdout.trim());
}

async function install(root) {
  await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, timeout: INSTALL_MS });
}

// The gate runs in its own process, so a crash in it cannot take the caller down. It prints its verdict as JSON.
async function gate(root) {
  const script = `import(${JSON.stringify(pathToFileURL(join(root, 'src', 'gate.mjs')).href)})`
    + `.then((m) => m.runGate(${JSON.stringify(root)}))`
    + `.then((r) => { process.stdout.write(JSON.stringify({ ok: r.ok, failed: r.failed })); process.exitCode = r.ok ? 0 : 1; }, (err) => { process.stdout.write(JSON.stringify({ ok: false, failed: [err.message] })); process.exitCode = 1; });`;
  try {
    const out = await run(process.execPath, ['--input-type=module', '-e', script], { cwd: root, timeout: GATE_MS });
    return JSON.parse(out.stdout);
  } catch (err) {
    try {
      return JSON.parse(err.stdout);
    } catch {
      return { ok: false, failed: [firstLine(err)] };
    }
  }
}

// The commit checked in a clone of the checkout at that commit. The clone shares the checkout's objects, and it creates no branch in the
// checkout, so the checkout is not touched. Its node_modules is shared with the checkout, or installed when the lock file changed.
async function candidate(root, target, lockChanged) {
  const dir = await mkdtemp(join(tmpdir(), 'gm-new-candidate-'));
  try {
    await run('git', ['clone', '--quiet', '--shared', '--no-checkout', root, dir], { timeout: FETCH_MS });
    await run('git', ['-C', dir, 'checkout', '--quiet', '--detach', target], { timeout: PULL_MS });
    if (lockChanged) await install(dir);
    else await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    return await gate(dir);
  } catch (err) {
    return { ok: false, failed: [`the commit could not be checked: ${firstLine(err)}`] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// One check. It returns what it did as { state, ... }, and it never throws. busy() returns why the worker's work must not be interrupted now,
// or null. nextWorkerEvent(ms) resolves with the supervisor's next report of the worker's state, or null after ms.
export async function checkForUpdate(root, { log = () => {}, busy = null, nextWorkerEvent = null, replaceCore = null } = {}) {
  try {
    await git(root, ['remote', 'get-url', 'origin']);
  } catch {
    return { state: 'no-remote' };
  }
  try {
    await git(root, ['fetch', '--quiet', 'origin', 'main'], FETCH_MS);
  } catch (err) {
    return { state: 'offline', error: firstLine(err) };
  }
  const head = await git(root, ['rev-parse', 'HEAD']);
  const target = await git(root, ['rev-parse', 'origin/main']);
  if (head === target) return { state: 'current', head };
  const ancestor = await run('git', ['merge-base', '--is-ancestor', head, target], { cwd: root }).then(() => true, () => false);
  if (!ancestor) return { state: 'diverged', head, target };
  const ahead = Number(await git(root, ['rev-list', '--count', `${head}..${target}`]));
  if (refused.has(target)) return { state: 'refused', reason: refused.get(target), head, target, ahead };
  const dirty = await git(root, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty !== '') return { state: 'dirty', head, target, ahead };
  const waiting = busy?.() ?? null;
  if (waiting) return { state: 'waiting', reason: waiting, head, target, ahead };
  return apply(root, head, target, ahead, log, { busy, nextWorkerEvent, replaceCore });
}

async function apply(root, prev, target, ahead, log, { busy, nextWorkerEvent, replaceCore }) {
  const changed = (await git(root, ['diff', '--name-only', prev, target])).split('\n').filter(Boolean);
  const lockChanged = changed.includes('package-lock.json');
  // A skill file is served in place (the core refreshes the lists), so only src/ restarts the worker.
  const restarts = changed.some((file) => file.startsWith('src/'));
  const replaces = changed.some((file) => file.startsWith('tools/') && file !== 'tools/relay.mjs');
  const verdict = await candidate(root, target, lockChanged);
  if (verdict.ok !== true) {
    const reason = `the gate failed on the new commit: ${verdict.failed.join(', ')}`;
    log(`not pulled ${short(target)}: ${reason}`);
    refused.set(target, reason);
    return { state: 'rejected', head: prev, target, reason };
  }
  // Checked again after the candidate: a body or a job may have started while the commit was checked.
  const waiting = busy?.() ?? null;
  if (waiting) return { state: 'waiting', reason: waiting, head: prev, target, ahead };
  const dirty = await git(root, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty !== '') return { state: 'dirty', head: prev, target, ahead };
  // The wait for the restart starts before the pull, so the supervisor's report of it is not missed.
  const outcome = restarts && nextWorkerEvent ? nextWorkerEvent(WORKER_MS) : null;
  let landed = false;
  try {
    await git(root, ['merge', '--ff-only', '--quiet', target], PULL_MS);
    landed = true;
    if (lockChanged) await install(root);
  } catch (err) {
    if (!landed) return { state: 'failed', error: firstLine(err) };
    return rollback(root, prev, target, lockChanged, restarts, `the install failed (${firstLine(err)})`, { log, nextWorkerEvent });
  }
  // A pull that changes the core replaces it. The new core is checked and loaded before it takes over, and it starts the worker itself.
  if (replaces && replaceCore) {
    const handed = await replaceCore(`pulled ${short(target)}`);
    if (handed.ok) return { state: 'updated', from: prev, to: target, ahead, changed, verified: true, restarted: true };
    return rollback(root, prev, target, lockChanged, restarts, `the new core did not take over (${handed.reason})`, { log, nextWorkerEvent });
  }
  if (!outcome) {
    log(`pulled ${ahead} commit(s) to ${short(target)}; the gate passed`);
    return { state: 'updated', from: prev, to: target, ahead, changed, verified: false, restarted: restarts };
  }
  const answered = await outcome;
  if (answered?.state === 'running') {
    log(`pulled ${ahead} commit(s) to ${short(target)}; the gate passed, and the worker answered on the new code`);
    return { state: 'updated', from: prev, to: target, ahead, changed, verified: true, restarted: true };
  }
  const why = answered?.state === 'failed'
    ? `the worker did not start on the new code (${answered.reason})`
    : `the worker did not report a start within ${WORKER_MS} ms`;
  return rollback(root, prev, target, lockChanged, restarts, why, { log, nextWorkerEvent });
}

// The next report that the worker is running, or null at the deadline. A report that it failed is an old attempt, as the supervisor keeps
// retrying the broken code until the checkout is reset, so it is not taken as the outcome of the rollback.
async function untilRunning(nextWorkerEvent, deadline) {
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const event = await nextWorkerEvent(left);
    if (event === null) return null;
    if (event.state === 'running') return event;
  }
}

// Undoes a pull: the checkout goes back to the commit before it, and the worker is restarted on the old code by the supervisor's watch on
// src/ and skills/. The rollback is logged. When the worker does not start on the old code either, the state is stuck, for a person to check.
async function rollback(root, prev, target, lockChanged, restarts, why, { log, nextWorkerEvent }) {
  refused.set(target, why);
  const back =restarts && nextWorkerEvent ? untilRunning(nextWorkerEvent, Date.now() + WORKER_MS) : null;
  try {
    await git(root, ['reset', '--hard', '--quiet', prev], PULL_MS);
    if (lockChanged) await install(root);
  } catch (err) {
    log(`pulled ${short(target)}, ${why}; the reset to ${short(prev)} failed: ${firstLine(err)}`);
    return { state: 'stuck', from: prev, to: target, reason: why, error: firstLine(err) };
  }
  const answered = back ? await back : null;
  if (back && answered === null) {
    log(`rolled back ${short(target)} to ${short(prev)}, but the worker did not start on the old code either; check the checkout by hand`);
    return { state: 'stuck', from: prev, to: target, reason: why, error: 'the worker did not start on the old code' };
  }
  log(`rolled back ${short(target)} to ${short(prev)}: ${why}; the worker answers on ${short(prev)}`);
  return { state: 'rolled-back', from: prev, to: target, reason: why };
}

function describe(result) {
  switch (result.state) {
    case 'updated': return `updated ${result.ahead} commit(s)${result.verified ? '; the worker answers on the new code' : result.restarted ? '; the worker restarts on the changed files' : '; no file under src/ or skills/ changed, so the worker did not restart'}`;
    case 'reverted': return `pulled code that ${result.reason}, and reset to the commit before it`;
    case 'stuck': return `pulled code that ${result.reason}, and the reset failed (${result.error}); check the checkout by hand`;
    case 'dirty': return `origin main is ${result.ahead} commit(s) ahead, but the checkout has changes to tracked files, so nothing was pulled`;
    case 'diverged': return 'the checkout and origin main have diverged, so nothing was pulled';
    case 'offline': return `origin could not be reached, so the check was skipped (${result.error})`;
    case 'failed': return `the pull failed (${result.error})`;
    case 'no-remote': return 'the checkout has no origin, so there is nothing to pull';
    case 'rejected': return `origin main is ahead, but the new commit was not pulled: ${result.reason}`;
    case 'refused': return `origin main points at a commit that was refused (${result.reason}); it is not tried again until origin moves`;
    case 'waiting': return `origin main is ahead; the pull waits for ${result.reason}`;
    case 'rolled-back': return `pulled ${short(result.to)} and rolled it back to ${short(result.from)}: ${result.reason}`;
    default: return result.state;
  }
}

// Starts the checks: the first after FIRST_CHECK_MS, then every everyMs. Zero, or anything that is not a positive number, turns them off. A check
// that is still running is not started again. The timers do not keep the process alive. It returns a function that stops the checks.
export function startUpdates({ root, everyMs = DEFAULT_UPDATE_MS, log = () => {}, busy = null, nextWorkerEvent = null, replaceCore = null }) {
  if (!(everyMs > 0)) return () => {};
  let running = false;
  let retry = null;
  let lastWait = null;
  const tick = async () => {
    if (running) return;
    running = true;
    clearTimeout(retry);
    retry = null;
    try {
      const result = await checkForUpdate(root, { log, busy, nextWorkerEvent, replaceCore });
      if (result.state === 'waiting') {
        // The pull waits, and it is tried again soon, so a body or a job that ends does not wait for the next check. It is logged once for each wait.
        if (lastWait !== result.reason) log(describe(result));
        lastWait = result.reason;
        retry = setTimeout(tick, WAIT_RETRY_MS);
        retry.unref();
      } else {
        lastWait = null;
        if (result.state !== 'current') log(describe(result));
      }
    } catch (err) {
      log(`the check failed: ${firstLine(err)}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, FIRST_CHECK_MS);
  const timer = setInterval(tick, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    clearTimeout(retry);
  };
}
