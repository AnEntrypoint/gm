#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..');

function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip && skip(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

function buildVsix(stageDir) {
  copyDir(PKG_DIR, stageDir, (n) => n === 'node_modules' || n === '.git' || n === 'bin');
  const pkgPath = path.join(stageDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  delete pkg.files;
  delete pkg.bin;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log('[gm-antigravity] packaging VSIX in ' + stageDir);
  const args = ['--yes', '@vscode/vsce@latest', 'package',
    '--allow-star-activation', '--skip-license', '--no-dependencies', '--out', 'extension.vsix'];
  const r = spawnSync('npx', args, { cwd: stageDir, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('[gm-antigravity] vsce package failed (exit ' + r.status + ')');
    process.exit(5);
  }
  return path.join(stageDir, 'extension.vsix');
}

function findAntigravityCli() {
  const candidates = [];
  const exe = process.platform === 'win32' ? 'antigravity.cmd' : 'antigravity';
  const exeAlt = process.platform === 'win32' ? 'antigravity.exe' : null;
  const PATH = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) candidates.push(p);
    if (exeAlt) {
      const p2 = path.join(dir, exeAlt);
      if (fs.existsSync(p2)) candidates.push(p2);
    }
  }
  const home = os.homedir();
  const wellKnown = process.platform === 'win32' ? [
    path.join(home, 'AppData', 'Local', 'Programs', 'Antigravity', 'bin', 'antigravity.cmd'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Antigravity', 'bin', 'antigravity.exe'),
    'C:\\Program Files\\Antigravity\\bin\\antigravity.cmd',
    'C:\\Program Files\\Antigravity\\bin\\antigravity.exe'
  ] : process.platform === 'darwin' ? [
    '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity',
    path.join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app', 'bin', 'antigravity')
  ] : [
    '/usr/bin/antigravity',
    '/usr/local/bin/antigravity',
    '/opt/Antigravity/bin/antigravity',
    path.join(home, '.local', 'bin', 'antigravity')
  ];
  for (const p of wellKnown) if (fs.existsSync(p)) candidates.push(p);
  return candidates[0] || null;
}

function main() {
  const cli = findAntigravityCli();
  if (!cli) {
    console.error('[gm-antigravity] antigravity CLI not found. Install Google Antigravity IDE first: https://antigravity.google');
    console.error('  Searched PATH and standard install locations.');
    process.exit(3);
  }
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-antigravity-'));
  let vsix;
  try {
    vsix = buildVsix(stage);
  } catch (e) {
    console.error('[gm-antigravity] vsix build failed:', e && e.message);
    process.exit(5);
  }
  console.log('[gm-antigravity] using CLI: ' + cli);
  console.log('[gm-antigravity] installing: ' + vsix);
  const cmdArgs = process.platform === 'win32' ? ['--install-extension', '"' + vsix + '"', '--force'] : ['--install-extension', vsix, '--force'];
  const cmdCli = process.platform === 'win32' ? '"' + cli + '"' : cli;
  const r = spawnSync(cmdCli, cmdArgs, { stdio: 'inherit', shell: true });
  if (r.error) { console.error('[gm-antigravity] spawn failed:', r.error.message); process.exit(4); }
  try { fs.rmSync(stage, { recursive: true, force: true }); } catch (e) {}
  process.exit(r.status || 0);
}

main();
