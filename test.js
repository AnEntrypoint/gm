#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = process.cwd();
const SPOOL = path.join(ROOT, '.gm', 'exec-spool');
const IN = path.join(SPOOL, 'in');
const OUT = path.join(SPOOL, 'out');
const STATUS = path.join(SPOOL, '.status.json');

let SEQ = 0;
function nextId(verb) { return `test-${process.pid}-${++SEQ}-${verb}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }

async function ensureWatcher() {
  let st = readJson(STATUS);
  if (st && st.pid && (Date.now() - (st.ts || 0)) < 15000) {
    try { process.kill(st.pid, 0); return; } catch (_) {}
  }
  const child = cp.spawn('bun', ['x', 'gm-plugkit@latest', 'spool'], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, shell: true,
  });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    st = readJson(STATUS);
    if (st && st.pid && (Date.now() - (st.ts || 0)) < 10000) {
      try { process.kill(st.pid, 0); return; } catch (_) {}
    }
    await sleep(500);
  }
  throw new Error('watcher boot timeout');
}

async function dispatch(verb, body, timeoutMs = 30000) {
  const id = nextId(verb.replace(/[^a-z0-9]/gi, ''));
  const inDir = path.join(IN, verb);
  fs.mkdirSync(inDir, { recursive: true });
  const inFile = path.join(inDir, `${id}.txt`);
  const outFile = path.join(OUT, `${verb}-${id}.json`);
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const tmp = inFile + '.tmp';
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, inFile);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(outFile)) return JSON.parse(fs.readFileSync(outFile, 'utf8'));
    await sleep(100);
  }
  throw new Error(`timeout: ${verb} after ${timeoutMs}ms`);
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.ts', '.tsx', '.jsx', '.css', '.html', '.yml', '.yaml', '.txt', '.sh']);
function checkNoBom() {
  const out = cp.execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = out.split('\n').map(s => s.trim()).filter(Boolean).filter(f => TEXT_EXT.has(path.extname(f).toLowerCase()));
  const offenders = [];
  for (const f of files) {
    const abs = path.join(ROOT, f);
    let fd;
    try { fd = fs.openSync(abs, 'r'); } catch (_) { continue; }
    const head = Buffer.alloc(3);
    try { fs.readSync(fd, head, 0, 3, 0); } finally { fs.closeSync(fd); }
    if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) offenders.push(f);
  }
  assert(offenders.length === 0, 'UTF-8 BOM in tracked text files (breaks node/JSON): ' + offenders.join(', '));
  console.log('no-BOM guard ok (' + files.length + ' text files)');
}

async function main() {
  checkNoBom();
  await ensureWatcher();
  console.log('watcher alive');

  const inst = await dispatch('instruction', { prompt: 'test integration probe' });
  assert(inst.ok, 'instruction ok');
  assert(inst.data && typeof inst.data === 'object', 'instruction data is object');
  console.log('instruction ok phase=' + (inst.data.phase || '?'));

  const rec = await dispatch('recall', { query: 'spool dispatch architecture' });
  assert(rec.ok, 'recall ok');
  assert(Array.isArray(rec.data.hits), 'recall hits array');
  assert(rec.data.hits.length > 0, 'recall hits non-empty for spool dispatch');
  console.log('recall ok hits=' + rec.data.hits.length);

  const health = await dispatch('health', {});
  assert(health.ok, 'health ok');
  console.log('health ok version=' + (health.data.version || '?'));

  console.log('PASS');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
