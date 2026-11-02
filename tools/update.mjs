// Updates from the repository. A checkout of gm-new is a clone of origin main, so an update is a fast-forward pull. A check fetches origin.
// When main is ahead and no tracked file has changes, it pulls, runs npm ci when the lock file changed, and runs the gate on the result. A
// pull that the gate rejects is undone with git reset to the commit the checkout had before the pull, so the checkout never keeps code the
// gate rejects. A pull changes files under src/ and skills/, and the supervisor restarts the worker when those change, so the new code is
// loaded by that restart, and the run resumes from its log. A checkout with changes, or a history that has diverged, is reported and left
// alone. A check that cannot reach origin is reported and skipped. The checks never throw.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
export const DEFAULT_UPDATE_MS = 3600000;
const FIRST_CHECK_MS = 30000;
const SHORT_MS = 10000;
const FETCH_MS = 60000;
const PULL_MS = 60000;
const INSTALL_MS = 600000;
const GATE_MS = 600000;

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

// One check. It returns what it did as { state, ... }, and it never throws.
export async function checkForUpdate(root, { log = () => {} } = {}) {
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
  const dirty = await git(root, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty !== '') return { state: 'dirty', head, target, ahead };
  return apply(root, head, target, ahead, log);
}

async function apply(root, prev, target, ahead, log) {
  try {
    await git(root, ['merge', '--ff-only', '--quiet', target], PULL_MS);
  } catch (err) {
    return { state: 'failed', error: firstLine(err) };
  }
  const changed = (await git(root, ['diff', '--name-only', prev, 'HEAD'])).split('\n').filter(Boolean);
  const lockChanged = changed.includes('package-lock.json');
  let verdict;
  try {
    if (lockChanged) await install(root);
    verdict = await gate(root);
  } catch (err) {
    verdict = { ok: false, failed: [`install failed: ${firstLine(err)}`] };
  }
  if (verdict.ok === true) {
    log(`pulled ${ahead} commit(s) to ${short(target)}; the gate passed`);
    return { state: 'updated', from: prev, to: target, ahead, changed };
  }
  const reason = `the gate failed: ${verdict.failed.join(', ')}`;
  try {
    await git(root, ['reset', '--hard', '--quiet', prev], PULL_MS);
    if (lockChanged) await install(root);
    log(`pulled ${short(target)}, ${reason}; reset to ${short(prev)}`);
    return { state: 'reverted', from: prev, to: target, reason };
  } catch (err) {
    log(`pulled ${short(target)}, ${reason}; the reset to ${short(prev)} failed: ${firstLine(err)}`);
    return { state: 'stuck', from: prev, to: target, reason, error: firstLine(err) };
  }
}

function describe(result) {
  switch (result.state) {
    case 'updated': return `updated ${result.ahead} commit(s); the worker restarts on the changed files`;
    case 'reverted': return `pulled code that ${result.reason}, and reset to the commit before it`;
    case 'stuck': return `pulled code that ${result.reason}, and the reset failed (${result.error}); check the checkout by hand`;
    case 'dirty': return `origin main is ${result.ahead} commit(s) ahead, but the checkout has changes to tracked files, so nothing was pulled`;
    case 'diverged': return 'the checkout and origin main have diverged, so nothing was pulled';
    case 'offline': return `origin could not be reached, so the check was skipped (${result.error})`;
    case 'failed': return `the pull failed (${result.error})`;
    case 'no-remote': return 'the checkout has no origin, so there is nothing to pull';
    default: return result.state;
  }
}

// Starts the checks: the first after FIRST_CHECK_MS, then every everyMs. Zero, or anything that is not a positive number, turns them off. A check
// that is still running is not started again. The timers do not keep the process alive. It returns a function that stops the checks.
export function startUpdates({ root, everyMs = DEFAULT_UPDATE_MS, log = () => {} }) {
  if (!(everyMs > 0)) return () => {};
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await checkForUpdate(root, { log });
      if (result.state !== 'current') log(describe(result));
    } catch (err) {
      log(`the check failed: ${firstLine(err)}`);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, FIRST_CHECK_MS);
  const timer = setInterval(tick, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
