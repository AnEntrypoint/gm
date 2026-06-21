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

const CODE_EXT = new Set(['.js', '.mjs', '.cjs']);
function checkNoComments() {
  const out = cp.execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(f => CODE_EXT.has(path.extname(f).toLowerCase()))
    .filter(f => !f.startsWith('.gm/'));
  const offenders = [];
  for (const f of files) {
    const abs = path.join(ROOT, f);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
    const lines = text.split(/\r?\n/);
    let inTemplate = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inTemplate && /^\s*(\/\/|\/\*)/.test(line)) { offenders.push(f + ':' + (i + 1)); break; }
      let backticks = 0;
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '`' && line[j - 1] !== '\\') backticks++;
      }
      if (backticks % 2 === 1) inTemplate = !inTemplate;
    }
  }
  assert(offenders.length === 0, 'leading // or /* comments in tracked code (No-comments rule): ' + offenders.slice(0, 10).join(', '));
  console.log('no-comments guard ok (' + files.length + ' code files)');
}

function checkVersionConsistency() {
  const gmJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'gm.json'), 'utf8'));
  const canonical = String(gmJson.plugkitVersion || '').trim();
  assert(canonical, 'gm.json missing plugkitVersion');
  for (const rel of ['bin/plugkit.version', 'gm-plugkit/plugkit.version']) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const got = fs.readFileSync(abs, 'utf8').trim();
    assert(got === canonical, 'version drift: ' + rel + '=' + got + ' but gm.json.plugkitVersion=' + canonical);
  }
  console.log('version-consistency guard ok (plugkitVersion ' + canonical + ')');
}

function checkWasmNotPublished() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const reincludesBinDir = files.some(f => f === 'bin' || f === 'bin/' || f === 'bin/*' || f === 'bin/**');
  assert(!reincludesBinDir, 'package.json files[] re-includes the whole bin/ dir, which ships bin/plugkit.wasm (149MB) in the npm tarball -- list specific bin/* files instead, excluding plugkit.wasm (the bootstrap re-fetches it sha256-pinned)');
  assert(!files.includes('bin/plugkit.wasm'), 'package.json files[] explicitly lists bin/plugkit.wasm -- the 149MB binary must not ship; only its sha256 pin does');
  console.log('wasm-not-published guard ok');
}

function checkNoTestFilesShipped() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const shipsPlugkitDir = files.some(f => f === 'gm-plugkit' || f === 'gm-plugkit/' || f === 'gm-plugkit/*' || f === 'gm-plugkit/**');
  assert(!shipsPlugkitDir, 'package.json files[] ships the whole gm-plugkit/ dir, which carries *.test.js dev fixtures into the npm tarball (.npmignore cannot subtract from a files[] dir inclusion). Enumerate the specific gm-plugkit runtime files instead, excluding *.test.js');
  const shipsTest = files.some(f => /\.test\.js$/.test(f));
  assert(!shipsTest, 'package.json files[] explicitly lists a *.test.js file -- dev fixtures must not ship');
  console.log('no-test-files-shipped guard ok');
}

function checkUpdateWarningWired() {
  const src = fs.readFileSync(path.join(ROOT, 'gm-plugkit', 'plugkit-wasm-wrapper.js'), 'utf8');
  assert(/function injectUpdateWarning\s*\(/.test(src), 'injectUpdateWarning() missing -- the running runtime must continuously warn when a newer version is published but not running');
  assert(/\.update-available\.json/.test(src), 'injectUpdateWarning must read .update-available.json as the staleness source');
  assert(/update_warning/.test(src), 'injectUpdateWarning must set an update_warning imperative on the response');
  const callCount = (src.match(/injectUpdateWarning\s*\(/g) || []).length;
  assert(callCount >= 3, 'injectUpdateWarning must be defined AND called in both the autoRecall and instruction/transition/phase-status post-process branches (>=3 references), so the warning fires on every agent-facing response; found ' + callCount);
  console.log('update-warning-wired guard ok');
}

function checkAgentsMdBudget() {
  const CEILING = 36000;
  const abs = path.join(ROOT, 'AGENTS.md');
  const bytes = fs.statSync(abs).size;
  assert(bytes <= CEILING, 'AGENTS.md is ' + bytes + ' bytes, over the ' + CEILING + '-byte ceiling -- a detail-heavy/single-crate/single-platform entry has accreted instead of draining to an rs-learn recall: pointer. The looper failure mode (AGENTS.md grew to ~79k despite having rs-learn.db) is exactly this guard going unenforced. Drain a detail-heavy entry to a one-line recall: pointer (memorize-fire the substance) until under ceiling; never compress a top-level cross-cutting rule to make budget');
  const src = fs.readFileSync(abs, 'utf8');
  assert(/recall:/.test(src), 'AGENTS.md has no `recall:` pointer -- detail must externalize to rs-learn, not live inline');
  console.log('agents-md-budget guard ok (' + bytes + '/' + CEILING + ' bytes)');
}

async function main() {
  checkNoBom();
  checkNoComments();
  checkVersionConsistency();
  checkWasmNotPublished();
  checkNoTestFilesShipped();
  checkUpdateWarningWired();
  checkAgentsMdBudget();
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
