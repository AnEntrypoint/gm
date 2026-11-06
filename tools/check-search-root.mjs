#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { once } from 'node:events';

const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'));
import { createSearchVerbs } from '../src/search.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const WATCHDOG_MS = 120000;
const watchdog = setTimeout(() => {
  console.error(`search-root-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const TOKEN = 'SEARCH_ROOT_FIXTURE_TOKEN';
const workspace = mkdtempSync(join(tmpdir(), 'gm-search-root-'));
const failures = [];
const PACKAGE_FILES = 4400;
spawnSync('git', ['init', '-q'], { cwd: workspace });
mkdirSync(join(workspace, 'node_modules', 'pkg'), { recursive: true });
for (let i = 0; i < PACKAGE_FILES; i += 1) writeFileSync(join(workspace, 'node_modules', 'pkg', `f${String(i).padStart(4, '0')}.js`), `module.exports = ${i};\n`);
mkdirSync(join(workspace, 'src'), { recursive: true });
writeFileSync(join(workspace, 'src', 'token.js'), `export const ${TOKEN} = 1;\n`);
spawnSync('git', ['add', 'src'], { cwd: workspace });

function expectHit(label, output) {
  if (!String(output ?? '').includes(`src/token.js:1 export const ${TOKEN}`)) failures.push(`${label}: a whole-root scope all search missed ${TOKEN}`);
  console.log(JSON.stringify({ label, found: String(output ?? '').includes(TOKEN) }));
}

const verbs = createSearchVerbs({ root: workspace, confine: (rel) => ({ path: join(workspace, rel) }) });
const nodeReply = await verbs.grep({ pattern: TOKEN, scope: 'all', limit: 20 });
expectHit('node grep whole root scope all', nodeReply.output);

function nativeSession() {
  const child = spawn(binary, ['serve', '--workspace', workspace], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const pending = new Map();
  let nextId = 1;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const rpc = (method, params) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolveReply) => pending.set(id, resolveReply));
  };
  return { child, rpc };
}

if (binary !== null && existsSync(binary)) {
  const { child, rpc } = nativeSession();
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'search-root-check', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('tools/call', { name: 'next_context', arguments: { task: 'search root check' } });
    const reply = await rpc('tools/call', { name: 'run_code', arguments: { body: `return await gm.grep({ pattern: '${TOKEN}', scope: 'all', limit: 20 });` } });
    const parsed = JSON.parse(reply.result?.content?.[0]?.text ?? 'null');
    const grep = parsed?.ok === true ? JSON.parse(parsed.output) : null;
    if (grep === null) failures.push(`native: run_code refused: ${parsed?.error ?? 'no reply'}`);
    else expectHit('native grep whole root scope all', grep.output);
  } catch (error) {
    failures.push(`native: ${error.message}`);
  } finally {
    child.kill();
    await exited(child);
  }
} else {
  console.log('native grep: skipped (no binary given)');
}

rmSync(workspace, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`search-root-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(`search-root-check: passed: a whole-root search with scope all finds a token in a file past the ${PACKAGE_FILES} node_modules files`);
