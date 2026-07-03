#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const ROOT = process.cwd();
const SPOOL = path.join(ROOT, '.gm', 'exec-spool');
const IN = path.join(SPOOL, 'in'), OUT = path.join(SPOOL, 'out'), STATUS = path.join(SPOOL, '.status.json');

let SEQ = 0;
function nextId(verb) { return `test-${process.pid}-${++SEQ}-${verb}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }
function alive(st, maxAge) { if (!(st && st.pid && (Date.now() - (st.ts || 0)) < maxAge)) return false; try { process.kill(st.pid, 0); return true; } catch (_) { return false; } }

async function ensureWatcher() {
  if (alive(readJson(STATUS), 15000)) return;
  const r = cp.spawnSync('bun', ['x', 'gm-plugkit@latest', 'spool'],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, shell: true, timeout: 90000 });
  if (r.status !== 0 || !alive(readJson(STATUS), 15000)) throw new Error('atomic spool boot did not leave a fresh watcher (status=' + (r && r.status) + ')');
}

async function dispatch(verb, body, timeoutMs = 30000) {
  const id = nextId(verb.replace(/[^a-z0-9]/gi, ''));
  const inFile = path.join(IN, verb, `${id}.txt`);
  const outFile = path.join(OUT, `${verb}-${id}.json`);
  fs.mkdirSync(path.dirname(inFile), { recursive: true });
  fs.writeFileSync(inFile + '.tmp', typeof body === 'string' ? body : JSON.stringify(body));
  fs.renameSync(inFile + '.tmp', inFile);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(outFile)) return JSON.parse(fs.readFileSync(outFile, 'utf8'));
    await sleep(100);
  }
  throw new Error(`timeout: ${verb} after ${timeoutMs}ms`);
}

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }
function parseData(r) { return r && r.data ? (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) : null; }

function gitFiles(exts, excludeGm) {
  const out = cp.execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(f => exts.has(path.extname(f).toLowerCase()))
    .filter(f => !excludeGm || !f.startsWith('.gm/'));
}

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.ts', '.tsx', '.jsx', '.css', '.html', '.yml', '.yaml', '.txt', '.sh']);
function checkNoBom() {
  const files = gitFiles(TEXT_EXT, false);
  const offenders = files.filter(f => {
    let fd; try { fd = fs.openSync(path.join(ROOT, f), 'r'); } catch (_) { return false; }
    const head = Buffer.alloc(3);
    try { fs.readSync(fd, head, 0, 3, 0); } finally { fs.closeSync(fd); }
    return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
  });
  assert(offenders.length === 0, 'UTF-8 BOM in tracked text files (breaks node/JSON): ' + offenders.join(', '));
  console.log('no-BOM guard ok (' + files.length + ' text files)');
}

const CODE_EXT = new Set(['.js', '.mjs', '.cjs']);
function checkNoComments() {
  const files = gitFiles(CODE_EXT, true);
  const offenders = [];
  for (const f of files) {
    let text; try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
    let inTemplate = false;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!inTemplate && /^\s*(\/\/|\/\*)/.test(lines[i])) { offenders.push(f + ':' + (i + 1)); break; }
      let bt = 0;
      for (let j = 0; j < lines[i].length; j++) if (lines[i][j] === '`' && lines[i][j - 1] !== '\\') bt++;
      if (bt % 2 === 1) inTemplate = !inTemplate;
    }
  }
  assert(offenders.length === 0, 'leading // or /* comments in tracked code (No-comments rule): ' + offenders.slice(0, 10).join(', '));
  console.log('no-comments guard ok (' + files.length + ' code files)');
}

function checkVersionConsistency() {
  const canonical = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'gm.json'), 'utf8')).plugkitVersion || '').trim();
  assert(canonical, 'gm.json missing plugkitVersion');
  for (const rel of ['bin/plugkit.version', 'gm-plugkit/plugkit.version']) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) assert(fs.readFileSync(abs, 'utf8').trim() === canonical, 'version drift: ' + rel + ' != gm.json.plugkitVersion=' + canonical);
  }
  console.log('version-consistency guard ok (plugkitVersion ' + canonical + ')');
}

function checkPackageFilesHygiene() {
  const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).files || [];
  assert(!files.some(f => /^bin\/?\*{0,2}$/.test(f)) && !files.includes('bin/plugkit.wasm') && !files.some(f => /^gm-plugkit\/?\*{0,2}$/.test(f)) && !files.some(f => /\.test\.js$/.test(f)),
    'package.json files[] must not re-include bin/ wholesale, list bin/plugkit.wasm (149MB, bootstrap re-fetches sha256-pinned), ship whole gm-plugkit/ dir, or any *.test.js dev fixture');
  console.log('package-files-hygiene guard ok');
}

function checkUpdateWarningWired() {
  const src = fs.readFileSync(path.join(ROOT, 'gm-plugkit', 'plugkit-wasm-wrapper.js'), 'utf8');
  assert(/function injectUpdateWarning\s*\(/.test(src) && /\.update-available\.json/.test(src) && /update_warning/.test(src) && (src.match(/injectUpdateWarning\s*\(/g) || []).length >= 3,
    'injectUpdateWarning() must exist, read .update-available.json, set update_warning, and be called from autoRecall + instruction/transition/phase-status branches (>=3 refs)');
  console.log('update-warning-wired guard ok');
}

function checkRenameAndInstaller() {
  assert(!fs.existsSync(path.join(ROOT, 'skills', 'gm-skill')), 'skills/gm-skill must not exist after rename');
  const skillMd = path.join(ROOT, 'skills', 'gm', 'SKILL.md');
  assert(fs.existsSync(skillMd) && /^name:\s*gm\s*$/m.test(fs.readFileSync(skillMd, 'utf8').split(/\r?\n/).slice(0, 12).join('\n')),
    'skills/gm/SKILL.md missing or frontmatter name != gm');
  assert(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name === 'gm-skill', 'npm package id must stay gm-skill');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-install-'));
  try {
    cp.execFileSync(process.execPath, [path.join(ROOT, 'bin', 'install.js'), 'install', '--yes'],
      { env: Object.assign({}, process.env, { HOME: tmpHome, USERPROFILE: tmpHome }), stdio: 'ignore', timeout: 25000 });
  } catch (e) { if (e.code !== 'ETIMEDOUT') throw e; }
  assert(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'gm', 'SKILL.md')), 'installer must land skill at <home>/.claude/skills/gm/SKILL.md');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf8'));
  assert(s.effortLevel === 'low' && s.alwaysThinkingEnabled === false && s.autoCompactWindow === undefined && s.autoCompactEnabled === undefined,
    'installer must set effortLevel=low, alwaysThinkingEnabled=false, and never set autoCompactWindow/autoCompactEnabled');
  fs.rmSync(tmpHome, { recursive: true, force: true });
  console.log('rename+installer guard ok');
}

function checkAgentsMdBudget() {
  const CEILING = 36000, abs = path.join(ROOT, 'AGENTS.md'), bytes = fs.statSync(abs).size;
  assert(bytes <= CEILING, 'AGENTS.md is ' + bytes + '/' + CEILING + ' bytes -- detail has accreted instead of draining to an rs-learn recall: pointer; memorize-fire the substance and compress to one line until under ceiling');
  assert(/recall:/.test(fs.readFileSync(abs, 'utf8')), 'AGENTS.md has no `recall:` pointer -- detail must externalize to rs-learn');
  console.log('agents-md-budget guard ok (' + bytes + '/' + CEILING + ' bytes)');
}

function checkConstraintsMdSeedAndIdempotency() {
  const target = path.join(ROOT, '.gm', 'constraints.md');
  if (!fs.existsSync(target)) { console.log('constraints-md guard skipped (not yet seeded, expected transient)'); return; }
  const marker = 'test-marker-' + process.pid + '-do-not-overwrite';
  const orig = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, orig + '\n' + marker + '\n');
  try {
    cp.execFileSync(process.execPath, ['-e', "require(path.join(process.env.GM_ROOT,'gm-plugkit','bootstrap.js')).ensureInstructionsBundle(process.env.GM_ROOT)"],
      { env: Object.assign({}, process.env, { GM_ROOT: ROOT }), stdio: 'ignore', timeout: 15000 });
  } catch (_) {}
  const after = fs.readFileSync(target, 'utf8');
  assert(after.includes(marker), 'constraints.md seed-if-absent must NOT overwrite a user-modified file on re-run (f.f=f idempotency) -- marker lost after re-seed');
  fs.writeFileSync(target, orig);
  console.log('constraints-md seed+idempotency guard ok');
}

function checkSpoolDispatchGates() {
  const { checkDispatchGates, isSpoolPollCommand, isNativeSearchCommand } = require('./lib/spool-dispatch.js');
  const gb = checkDispatchGates('s', 'verb', { verb: 'bash', body: { command: 'git commit -am "wip"' } });
  const pt = checkDispatchGates('s', 'verb', { verb: 'bash', body: { command: 'npm run build' } });
  assert(gb.allowed === false && /bash-git-bypass/.test(gb.reason) && pt.allowed === true, 'git-bypass denied + clean bash allowed');
  assert(!!isSpoolPollCommand('sleep 2; cat .gm/exec-spool/out/instruction-1.json') && isSpoolPollCommand('npm test') === null, 'spool-poll flagged, clean not');
  assert(!!isNativeSearchCommand('grep -rn "TODO" src/') && isNativeSearchCommand('grep TODO src/index.js') === null, 'grep -r flagged, single-file not');
  console.log('spool-dispatch-gates guard ok');
}

async function main() {
  checkNoBom();
  checkSpoolDispatchGates();
  checkNoComments();
  checkVersionConsistency();
  checkPackageFilesHygiene();
  checkUpdateWarningWired();
  checkRenameAndInstaller();
  checkAgentsMdBudget();
  checkConstraintsMdSeedAndIdempotency();
  await ensureWatcher();
  console.log('watcher alive');
  const inst = await dispatch('instruction', { prompt: 'test integration probe' });
  assert(inst.ok && inst.data && typeof inst.data === 'object', 'instruction ok + data object');
  console.log('instruction ok phase=' + (inst.data.phase || '?'));
  const rec = await dispatch('recall', { query: 'spool dispatch architecture' });
  assert(rec.ok && Array.isArray(rec.data.hits) && rec.data.hits.length > 0, 'recall ok + non-empty hits');
  console.log('recall ok hits=' + rec.data.hits.length);
  const health = await dispatch('health', {});
  assert(health.ok, 'health ok');
  console.log('health ok version=' + (health.data.version || '?'));
  const memText = 'idempotency witness probe ' + process.pid + ' f-compose-f-equals-f';
  const [m1, m2] = [await dispatch('memorize-fire', { text: memText }), await dispatch('memorize-fire', { text: memText })];
  assert(m1.ok && m2.ok && m2.data && m2.data.deduped === true && m1.data.key === m2.data.key,
    'memorize is idempotent (f.f=f): second identical fire must return deduped:true with the same content-hash key');
  console.log('idempotency witness ok (memorize deduped key=' + m2.data.key + ')');
  const pd = parseData(await dispatch('exec_js', { code: 'let s=0;for(let i=0;i<2e6;i++){s+=Math.sqrt(i);}await new Promise(r=>setTimeout(r,150));return{s};', opts: { profile: true, profileTopN: 5 }, timeoutMs: 20000 }));
  assert(pd && pd.profile && Array.isArray(pd.profile.culprits) && pd.profile.culprits.length > 0 && pd.profile.culprits.length <= 5 &&
    pd.mem && typeof pd.mem.rss_mb === 'number' && pd.wall_vs_cpu && pd.wall_vs_cpu.offcpu_us > 0,
    'exec_js profile must return culprits[] capped by profileTopN, mem.rss_mb, and wall_vs_cpu.offcpu_us>0 (~150ms setTimeout CPU sampler cannot see)');
  console.log('profile witness ok (culprits=' + pd.profile.culprits.length + ' offcpu_us=' + pd.wall_vs_cpu.offcpu_us + ')');
  const md = parseData(await dispatch('exec_js', { code: 'const a=[];for(let i=0;i<5e4;i++)a.push(i);return {len:a.length};', opts: { mem: true }, timeoutMs: 10000 }));
  assert(md && md.result && md.result.len === 50000 && md.mem && typeof md.mem.rss_mb === 'number' && typeof md.wall_ms === 'number',
    'exec_js opts.mem must return structured result + mem.rss_mb + wall_ms');
  const ed = parseData(await dispatch('exec_js', { code: 'const x=null;return x.y.z;', opts: { mem: true }, timeoutMs: 10000 }));
  assert(ed && ed.error && ed.error.name === 'TypeError' && /Cannot read properties of null/.test(ed.error.message),
    'exec_js opts.mem must return a structured error{name,message} on a throw');
  console.log('mem+error witness ok (rss=' + md.mem.rss_mb + ' err=' + ed.error.name + ')');
  console.log('PASS');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
