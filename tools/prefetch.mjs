import { spawnSync } from 'node:child_process';

const PIN = 'ebbba11';
const PACKAGE = `github:AnEntrypoint/pw#${PIN}`;
const TIMEOUT_MS = 900000;
const SHELL = process.platform === 'win32';

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: TIMEOUT_MS, shell: SHELL, windowsHide: true });
}

function cacheOf() {
  const result = run('npm', ['config', 'get', 'cache']);
  return result.status === 0 && result.stdout.trim() !== '' ? result.stdout.trim() : 'the npm cache';
}

function reasonOf(result) {
  if (result.error) return result.error.code === 'ETIMEDOUT' ? `no answer within ${TIMEOUT_MS / 1000} s` : result.error.message;
  const lines = (result.stderr ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length > 0) return lines.at(-1);
  return result.status === null ? `stopped by ${result.signal}` : `exit code ${result.status}`;
}

export function prefetch() {
  console.log(`setup: fetching the playwriter tools: pw ${PIN}, the browser tool gm uses. It downloads once into the npm cache at ${cacheOf()}, so the first gm start is quick. It can take a few minutes on a slow network. The browser itself starts only on first use, and this step starts no browser, gate or server.`);
  const started = Date.now();
  const result = run('npx', ['-y', '-p', PACKAGE, 'playwriter-project', 'help']);
  if (result.status === 0 && (result.stdout ?? '').includes('usage: playwriter-project')) {
    console.log(`setup: playwriter tools fetched in ${((Date.now() - started) / 1000).toFixed(1)} s. The browser starts on first use.`);
    return;
  }
  console.log(`setup: the playwriter tools were not fetched: ${reasonOf(result)}. gm still installs and runs, and the playwriter tools will be fetched on the first gm start. To retry, run ./setup.sh again.`);
}
