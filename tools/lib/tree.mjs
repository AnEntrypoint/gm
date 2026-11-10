import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rmSync } from 'node:fs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const gone = (child) => child.exitCode !== null || child.signalCode !== null;

export async function stopTree(child, graceMs = 5000) {
  const exited = gone(child) ? Promise.resolve() : once(child, 'exit').catch(() => {});
  if (!gone(child) && process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await Promise.race([once(killer, 'exit').catch(() => {}), sleep(15000)]);
  }
  child.kill();
  await Promise.race([exited, sleep(graceMs)]);
}

export async function removeTree(path) {
  for (let attempt = 1, wait = 50; ; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code) || attempt === 30) throw error;
      await sleep(wait);
      wait = Math.min(wait * 2, 1000);
    }
  }
}
