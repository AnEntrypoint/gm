import { spawn as spawnChild } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const TREE = process.env.GM_CHECK_TREE ?? `${process.pid}-${Date.now()}`;
const OWN = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const live = new Set();

const signalGroup = (child, signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {}
};

const sweep = () => {
  if (process.platform !== 'linux') return;
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    let env;
    try {
      env = readFileSync(`/proc/${name}/environ`).toString().split('\0');
    } catch {
      continue;
    }
    if (env.includes(`GM_GROUP=${OWN}`)) {
      try {
        process.kill(Number(name), 'SIGKILL');
      } catch {}
    }
  }
};

const stopAll = () => {
  for (const child of live) signalGroup(child, 'SIGKILL');
  live.clear();
  sweep();
};

export function spawn(command, args = [], options = {}) {
  const env = { ...(options.env ?? process.env), GM_CHECK_TREE: TREE, GM_GROUP: OWN };
  const child = spawnChild(command, args, { ...options, detached: true, env });
  live.add(child);
  const kill = child.kill.bind(child);
  child.kill = (signal = 'SIGTERM') => {
    signalGroup(child, signal);
    return kill(signal);
  };
  child.once('exit', () => {
    signalGroup(child, 'SIGKILL');
    live.delete(child);
  });
  return child;
}

process.on('exit', stopAll);
for (const [signal, number] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) {
  process.once(signal, () => {
    stopAll();
    process.exit(128 + number);
  });
}
