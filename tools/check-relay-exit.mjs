#!/usr/bin/env node
import { withoutPlaywriter } from './lib/no-playwriter.mjs';
import { spawn } from './lib/group.mjs';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const WATCHDOG_MS = 90000;
const watchdog = setTimeout(() => {
  console.error(`relay-exit-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

if (binary === null || !existsSync(binary)) {
  console.log('relay-exit-check: skipped (no binary given)');
  process.exit(0);
}

const MESSAGE = '--max-inflight must be a positive integer';
const workspace = withoutPlaywriter(mkdtempSync(join(tmpdir(), 'gm-relay-exit-check-')));
const failures = [];

function serveWith(flags, dir = workspace) {
  return new Promise((resolveRun) => {
    const child = spawn(binary, ['serve', '--workspace', dir, ...flags], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.resume();
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill();
      resolveRun({ code: null, stderr: `${stderr}[timed out]` });
    }, 20000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stderr });
    });
  });
}

const cases = [
  { flags: ['--max-inflight', '0'], message: MESSAGE },
  { flags: ['--max-inflight', 'abc'], message: MESSAGE },
  { flags: ['--max-inflight', '-3'], message: MESSAGE },
  { flags: ['--task', ''], message: '--task is empty' },
  { flags: ['--task', '   '], message: '--task is empty' },
];
const taskFile = join(workspace, 'task.md');
writeFileSync(taskFile, 'a task read from a file\n');
const missingDir = join(workspace, 'missing');

try {
  for (const { flags, message } of cases) {
    const run = await serveWith(flags);
    if (run.code === 0 || run.code === null) failures.push(`${flags.join(' ')}: the relay exited ${run.code}, not non-zero`);
    if (!run.stderr.includes(message)) failures.push(`${flags.join(' ')}: stderr does not carry "${message}": ${run.stderr.trim()}`);
    console.log(JSON.stringify({ flags, code: run.code, stderr: run.stderr.trim() }));
  }
  const missing = await serveWith([], missingDir);
  const missingMessage = `workspace is not a directory: ${missingDir}`;
  if (missing.code === 0 || missing.code === null) failures.push(`missing workspace: the relay exited ${missing.code}, not non-zero`);
  if (!missing.stderr.includes(missingMessage)) failures.push(`missing workspace: stderr does not carry "${missingMessage}": ${missing.stderr.trim()}`);
  console.log(JSON.stringify({ flags: ['--workspace', 'missing'], code: missing.code, stderr: missing.stderr.trim() }));
  for (const flags of [['--max-inflight', '2'], ['--task', 'a text task'], ['--task', taskFile]]) {
    const valid = await serveWith(flags);
    if (valid.code !== 0) failures.push(`${flags.join(' ')}: the relay exited ${valid.code}, not 0`);
    console.log(JSON.stringify({ flags, code: valid.code }));
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`relay-exit-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('relay-exit-check: passed: a bad --max-inflight, an empty --task and a missing workspace exit the relay non-zero with Node\'s text; valid flags exit 0');
