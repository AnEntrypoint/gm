#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = '/usr/bin/chromium';
const TIMEOUT_MS = 120000;
const page = join(root, 'tools', 'check-txiki-wasi-browser.html');
const target = process.argv[2];
if (!target || !existsSync(target)) {
  console.log('txiki-wasi-chromium-check: skipped (no wasm given)');
  process.exit(0);
}
if (!existsSync(CHROMIUM)) {
  console.error(`txiki-wasi-chromium-check: ${CHROMIUM} is missing`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'gm-txiki-chromium-'));
const started = Date.now();
const address = `${pathToFileURL(page).href}#${encodeURIComponent(resolve(target))}`;
const args = [
  '--headless',
  '--disable-gpu',
  '--allow-file-access-from-files',
  '--disable-background-networking',
  `--user-data-dir=${profile}`,
  '--virtual-time-budget=60000',
  '--dump-dom',
  address,
];

const dumped = await new Promise((done, fail) => {
  const child = spawn(CHROMIUM, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: TIMEOUT_MS });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('error', fail);
  child.on('close', (code, signal) => {
    if (code === 0 && signal === null) done({ stdout, stderr });
    else fail(new Error(`chromium exited with ${code ?? signal}: ${stderr.trim().slice(-2000)}`));
  });
});
const wall = Date.now() - started;
rmSync(profile, { recursive: true, force: true });

const match = dumped.stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
const result = match ? match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
if (!result.startsWith('txiki-wasi-browser-check: ok')) {
  console.error(result || `txiki-wasi-browser-check: no result in the dumped page\n${dumped.stdout.slice(0, 2000)}`);
  process.exitCode = 1;
} else {
  console.log(result);
  console.log(`txiki-wasi-chromium-check: wall ${wall} ms`);
}
