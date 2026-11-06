#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
const workspace = mkdtempSync(join(tmpdir(), 'gm-relay-exit-check-'));
const failures = [];

function serveWith(flags) {
  return new Promise((resolveRun) => {
    const child = spawn(binary, ['serve', '--workspace', workspace, ...flags], { stdio: ['pipe', 'pipe', 'pipe'] });
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

try {
  for (const value of ['0', 'abc', '-3']) {
    const run = await serveWith(['--max-inflight', value]);
    if (run.code === 0 || run.code === null) failures.push(`--max-inflight ${value}: the relay exited ${run.code}, not non-zero`);
    if (!run.stderr.includes(MESSAGE)) failures.push(`--max-inflight ${value}: stderr does not carry "${MESSAGE}": ${run.stderr.trim()}`);
    console.log(JSON.stringify({ flag: value, code: run.code, stderr: run.stderr.trim() }));
  }
  const valid = await serveWith(['--max-inflight', '2']);
  if (valid.code !== 0) failures.push(`--max-inflight 2: the relay exited ${valid.code}, not 0`);
  console.log(JSON.stringify({ flag: '2', code: valid.code }));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`relay-exit-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(`relay-exit-check: passed: a bad --max-inflight exits the relay non-zero with "${MESSAGE}", and a valid one exits 0`);
