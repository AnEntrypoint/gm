#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const REQUIRE_NEW_EMBED = ARGS.has('--require-new-embed');
const SPOOL = path.join(ROOT, '.gm', 'exec-spool');
const IN = path.join(SPOOL, 'in');
const OUT = path.join(SPOOL, 'out');
const PROFILE = path.join(ROOT, '.gm', 'browser-profile');
const PORTS = path.join(SPOOL, 'browser-ports.json');
const SESSIONS = path.join(SPOOL, 'browser-sessions.json');
const STATUS = path.join(SPOOL, '.status.json');
const WATCHER_LOG = path.join(SPOOL, '.watcher.log');
const WITNESS_DIR = path.join(ROOT, '.gm', 'witness');

function log(...a) { process.stderr.write('[gm-validate] ' + a.join(' ') + '\n'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }

let DISPATCH_SEQ = 0;
function nextTask(tag) { DISPATCH_SEQ++; return `validate-${process.pid}-${DISPATCH_SEQ}-${tag}`; }

async function dispatch(verb, body, timeoutMs = 60000) {
  const task = nextTask(verb.replace(/[^a-z0-9-]/gi, ''));
  const inDir = path.join(IN, verb);
  fs.mkdirSync(inDir, { recursive: true });
  const inFile = path.join(inDir, `${task}.txt`);
  const outFile = path.join(OUT, `${verb}-${task}.json`);
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const tmp = inFile + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, inFile);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(outFile)) {
      const txt = fs.readFileSync(outFile, 'utf8');
      try { return { ok: true, latency_ms: Date.now() - t0, response: JSON.parse(txt) }; }
      catch (e) { return { ok: false, latency_ms: Date.now() - t0, error: 'parse: ' + e.message, raw: txt }; }
    }
    await sleep(100);
  }
  return { ok: false, latency_ms: timeoutMs, error: 'timeout' };
}

async function ensureWatcher() {
  let st = readJson(STATUS);
  const now = Date.now();
  if (st && st.pid && (now - (st.ts || 0)) < 15000) {
    try { process.kill(st.pid, 0); log('watcher already up pid=' + st.pid); return st.pid; } catch (_) {}
  }
  log('booting watcher via bun x gm-plugkit@latest spool');
  const child = cp.spawn('bun', ['x', 'gm-plugkit@latest', 'spool'], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, shell: true,
  });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    st = readJson(STATUS);
    if (st && st.pid && (Date.now() - (st.ts || 0)) < 10000) {
      try { process.kill(st.pid, 0); log('watcher up pid=' + st.pid); return st.pid; } catch (_) {}
    }
    await sleep(500);
  }
  throw new Error('watcher boot timed out');
}

function findChromiumProcs() {
  try {
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|chromium|msedge' } | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress -Depth 3`;
    const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (!out.trim()) return [];
    const j = JSON.parse(out);
    return Array.isArray(j) ? j : [j];
  } catch (e) { return []; }
}

function findChromiumMainWindowTitleForPids(pids) {
  try {
    const list = pids.map(p => String(p)).join(',');
    const ps = `$ids = @(${list}); Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object Id, MainWindowTitle | ConvertTo-Json -Compress`;
    const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    if (!out.trim()) return [];
    const j = JSON.parse(out);
    return Array.isArray(j) ? j : [j];
  } catch (e) { return []; }
}

async function validateChromium() {
  const v = { ok: false, session_id: '', headed: false, window_title: '', errors: [] };
  log('Validation 1: chromium headed');
  rmrf(PROFILE);
  try { fs.unlinkSync(PORTS); } catch (_) {}
  try { fs.unlinkSync(SESSIONS); } catch (_) {}

  await dispatch('instruction', '{}', 30000).catch(() => {});
  const r = await dispatch('browser', 'session new', 90000);
  if (!r.ok) { v.errors.push('dispatch: ' + r.error); return v; }
  const resp = r.response || {};
  const data = resp.data || {};
  const stdout = data.stdout || '';
  const m = stdout.match(/Session\s+(\S+)\s+created/i) || stdout.match(/session_id["':\s]+([A-Za-z0-9_-]+)/i);
  v.session_id = (resp.session_id || data.session_id || (m && m[1]) || '').toString();
  if (!resp.ok && !data.ok) { v.errors.push('browser session new not ok: ' + JSON.stringify(resp).slice(0, 400)); }

  const t0 = Date.now();
  let matched = null;
  while (Date.now() - t0 < 30000) {
    const procs = findChromiumProcs();
    matched = procs.filter(p => p && typeof p.CommandLine === 'string' && p.CommandLine.toLowerCase().includes(PROFILE.toLowerCase().replace(/\\/g, '\\').toLowerCase()));
    if (matched.length === 0) {
      matched = procs.filter(p => p && typeof p.CommandLine === 'string' && /browser-profile/i.test(p.CommandLine) && p.CommandLine.includes(ROOT));
    }
    if (matched.length > 0) break;
    await sleep(500);
  }
  if (!matched || matched.length === 0) { v.errors.push('no chromium process with cwd browser-profile cmdline within 30s'); return v; }
  const pids = matched.map(p => p.ProcessId);
  log('chromium pids matching profile: ' + pids.join(','));

  const titles = findChromiumMainWindowTitleForPids(pids);
  if (titles.length > 0) {
    v.window_title = titles[0].MainWindowTitle || '';
  }
  if (!v.window_title) {
    await sleep(3000);
    const t2 = findChromiumMainWindowTitleForPids(pids);
    if (t2.length > 0) v.window_title = t2[0].MainWindowTitle || '';
  }
  v.headed = !!v.window_title;
  if (!v.headed) v.errors.push('no MainWindowTitle on any matched chromium pid (headless?)');

  const ports = readJson(PORTS) || {};
  let portMatch = false;
  for (const k of Object.keys(ports)) {
    const e = ports[k];
    if (e && pids.includes(e.pid)) { portMatch = true; break; }
  }
  if (!portMatch) v.errors.push('browser-ports.json has no entry whose pid matches running chromium');

  if (v.session_id) {
    try {
      fs.mkdirSync(WITNESS_DIR, { recursive: true });
      const shot = path.join(WITNESS_DIR, 'chromium-headed.png');
      const script = `await page.goto('about:blank'); const buf = await page.screenshot(); require('fs').writeFileSync(${JSON.stringify(shot)}, buf);`;
      await dispatch('browser', `session -s ${v.session_id} -e ${JSON.stringify(script)}`, 30000);
      v.screenshot = fs.existsSync(shot) ? shot : '';
    } catch (e) { v.errors.push('screenshot: ' + e.message); }
  }

  v.ok = v.headed && portMatch;
  return v;
}

function readWatcherLogTail(bytes = 64 * 1024) {
  try {
    const stat = fs.statSync(WATCHER_LOG);
    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(WATCHER_LOG, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (_) { return ''; }
}

async function validateEmbed() {
  const v = { ok: false, calls: [], p50_ms: 0, p95_ms: 0, crashed: false, recall_mode: '', recall_top_text: '', errors: [] };
  log('Validation 2: embed end-to-end (node)');
  const before = readWatcherLogTail();
  const beforeLen = before.length;

  const texts = [
    'gm-validate witness one ' + Date.now(),
    'gm-validate witness two ' + Date.now(),
    'gm-validate witness three ' + Date.now(),
  ];
  for (const text of texts) {
    const r = await dispatch('memorize-fire', { text, namespace: 'validate' }, 60000);
    const d = r.response && (r.response.data || r.response) || {};
    const ok = !!(r.ok && (r.response && r.response.ok) && (d.embedded === true || d.embedded === undefined) && (d.memorized !== false));
    v.calls.push({ text, latency_ms: r.latency_ms, ok, embedded: d.embedded === true, memorized: d.memorized !== false, error: r.error || (r.response && r.response.error) || null });
  }
  const lats = v.calls.map(c => c.latency_ms).sort((a, b) => a - b);
  v.p50_ms = lats[Math.floor(lats.length * 0.5)] || 0;
  v.p95_ms = lats[Math.max(0, Math.ceil(lats.length * 0.95) - 1)] || 0;

  const r = await dispatch('recall', { query: 'gm-validate witness', namespace: 'validate', limit: 3 }, 60000);
  const rd = (r.response && (r.response.data || r.response)) || {};
  v.recall_mode = rd.mode || '';
  const rows = rd.rows || rd.hits || [];
  v.recall_top_text = (rows[0] && (rows[0].text || rows[0].content)) || '';

  const after = readWatcherLogTail(256 * 1024);
  const delta = after.slice(Math.max(0, after.length - (after.length - beforeLen) - 2048));
  if (/proc_exit|panicked|wasm trap|RuntimeError/i.test(delta)) {
    v.crashed = true;
    v.errors.push('watcher log shows wasm crash');
  }

  const allOk = v.calls.every(c => c.ok);
  const recallOk = v.recall_top_text.includes('gm-validate witness');
  v.ok = allOk && recallOk && !v.crashed;
  if (!allOk) v.errors.push('not all memorize calls ok');
  if (!recallOk) v.errors.push('recall top hit did not contain witness text');
  if (REQUIRE_NEW_EMBED && v.recall_mode !== 'vector_top_k') v.errors.push('recall mode != vector_top_k (require-new-embed)');
  return v;
}

function which(cmd) {
  try {
    const out = cp.execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [cmd], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
    return out[0] || '';
  } catch (_) { return ''; }
}

async function validateBrowserEmbed() {
  const v = { ok: false, calls: [], p50_ms: 0, p95_ms: 0, recall_top_text: '', skipped: false, errors: [] };
  log('Validation 3: embed in browser via playwriter');
  const pw = which('playwriter') || which('playwriter.cmd');
  if (!pw) { v.skipped = true; v.errors.push('playwriter not found'); return v; }

  const tbDir = path.resolve(__dirname, '..');
  if (!fs.existsSync(path.join(tbDir, 'docs'))) { v.skipped = true; v.errors.push('repo docs/ missing -- cannot serve a fixture page'); return v; }

  let serveProc = null;
  let port;
  try {
    const r = cp.spawnSync(process.execPath, ['-e', "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>process.stdout.write(String(p)));});s.on('error',e=>{process.stderr.write(e.message);process.exit(1);});"], { encoding: 'utf-8', timeout: 5000 });
    if (r.status !== 0) throw new Error('could not allocate free port: ' + (r.stderr || 'unknown'));
    port = parseInt(r.stdout.trim(), 10);
  } catch (e) { v.errors.push('free-port alloc: ' + e.message); return v; }
  try {
    serveProc = cp.spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['serve', 'docs', '-l', String(port)], {
      cwd: tbDir, detached: true, stdio: 'ignore', windowsHide: true, shell: process.platform === 'win32',
    });
    serveProc.unref();
  } catch (e) { v.errors.push('serve spawn: ' + e.message); return v; }

  try {
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 20000) {
    try {
      await new Promise((res, rej) => {
        const req = require('http').get(`http://127.0.0.1:${port}/`, r => { r.resume(); res(); });
        req.on('error', rej);
        req.setTimeout(1500, () => req.destroy(new Error('timeout')));
      });
      ready = true; break;
    } catch (_) { await sleep(500); }
  }
  if (!ready) { v.errors.push('docs serve never came up on ' + port); return v; }

  let sessionId = '';
  try {
    const out = cp.execSync('playwriter session new', { encoding: 'utf8', windowsHide: true });
    const m = out.match(/Session\s+(\S+)\s+created/i) || out.match(/([A-Za-z0-9_-]{1,40})/);
    sessionId = (m && m[1]) || '';
  } catch (e) { v.errors.push('playwriter session new: ' + e.message); return v; }
  if (!sessionId) { v.errors.push('no session id from playwriter'); return v; }

  const script = `
await page.goto('http://127.0.0.1:${port}/');
await page.waitForLoadState('domcontentloaded');
const has = await page.evaluate(() => !!(window.__debug && window.__debug.gm));
if (!has) { return { skipped: true, reason: 'no window.__debug.gm' }; }
const out = { mems: [], recall: null };
for (const t of ['bw one ${Date.now()}', 'bw two ${Date.now()}', 'bw three ${Date.now()}']) {
  const t0 = performance.now();
  const r = await window.__debug.gm.memorize({ text: t, namespace: 'validate-browser' });
  out.mems.push({ ok: !!(r && r.ok), latency_ms: performance.now() - t0 });
}
out.recall = await window.__debug.gm.recall({ query: 'bw', namespace: 'validate-browser', limit: 3 });
return out;
`;
  let res = null;
  try {
    const tmpScript = path.join(os.tmpdir(), 'gm-validate-' + Date.now() + '.js');
    fs.writeFileSync(tmpScript, script);
    const out = cp.execFileSync(pw, ['-s', sessionId, '--timeout', '60000', '-f', tmpScript], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    try { fs.unlinkSync(tmpScript); } catch (_) {}
    const m = out.match(/\{[\s\S]*\}\s*$/);
    if (m) { try { res = JSON.parse(m[0]); } catch (_) {} }
    if (!res) v.errors.push('could not parse playwriter eval output');
  } catch (e) { v.errors.push('playwriter -e: ' + e.message); }

  if (res && res.skipped) { v.skipped = true; v.errors.push(res.reason || 'browser debug surface missing'); return v; }
  if (res && Array.isArray(res.mems)) {
    v.calls = res.mems;
    const lats = res.mems.map(c => c.latency_ms).sort((a, b) => a - b);
    v.p50_ms = Math.round(lats[Math.floor(lats.length * 0.5)] || 0);
    v.p95_ms = Math.round(lats[Math.max(0, Math.ceil(lats.length * 0.95) - 1)] || 0);
    const rows = (res.recall && (res.recall.rows || res.recall.hits)) || [];
    v.recall_top_text = (rows[0] && (rows[0].text || rows[0].content)) || '';
    const allOk = v.calls.every(c => c.ok);
    v.ok = allOk && v.recall_top_text.startsWith('bw');
    if (!allOk) v.errors.push('not all browser memorize calls ok');
  }
  return v;
  } finally {
    if (serveProc && serveProc.pid) {
      try {
        if (process.platform === 'win32') cp.execFileSync('taskkill', ['/F', '/T', '/PID', String(serveProc.pid)], { stdio: 'ignore', windowsHide: true });
        else process.kill(serveProc.pid, 'SIGTERM');
      } catch (_) {}
    }
  }
}

(async () => {
  const final = { chromium_headed: false, chromium_window_title: '', embed_node: { ok: false, p50_ms: 0, p95_ms: 0, crashed: false }, embed_browser: { ok: false, p50_ms: 0, p95_ms: 0, skipped: false } };
  let exit = 0;
  try {
    await ensureWatcher();
    const v1 = await validateChromium();
    final.chromium_headed = !!v1.ok;
    final.chromium_window_title = v1.window_title || '';
    final._v1 = v1;
    if (!v1.ok) exit = 1;

    const v2 = await validateEmbed();
    final.embed_node = { ok: v2.ok, p50_ms: v2.p50_ms, p95_ms: v2.p95_ms, crashed: v2.crashed, recall_mode: v2.recall_mode, errors: v2.errors };
    final._v2 = v2;
    if (!v2.ok) exit = 1;

    const v3 = await validateBrowserEmbed();
    final.embed_browser = { ok: v3.ok, p50_ms: v3.p50_ms, p95_ms: v3.p95_ms, skipped: !!v3.skipped, errors: v3.errors };
    final._v3 = v3;
    if (!v3.ok && !v3.skipped) exit = 1;
  } catch (e) {
    final.error = e.message;
    exit = 1;
  }
  process.stdout.write(JSON.stringify(final, null, 2) + '\n');
  process.exit(exit);
})();
