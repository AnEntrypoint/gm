#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const STAGING = '/tmp/plugforge-wave1-staging';
const FILES = [
  { src: 'gm.md', dest: 'agents/gm.md', isDir: false },
  { src: 'hooks', dest: 'hooks', isDir: true },
  { src: '.mcp.json', dest: '.mcp.json', isDir: false }
];

const args = process.argv.slice(2);
const targetDir = args.find(a => !a.startsWith('--')) || process.cwd();
const verbose = args.includes('--verbose');
const backup = args.includes('--backup');

function log(msg) { console.log(msg); }
function vlog(msg) { if (verbose) console.log(`  ${msg}`); }

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    const s = path.join(src, file), d = path.join(dest, file);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else { fs.copyFileSync(s, d); vlog(`Copied ${s} → ${d}`); }
  }
}

function backupFile(p) {
  if (!fs.existsSync(p)) return null;
  const stat = fs.statSync(p), ts = Date.now();
  const dir = path.dirname(p), ext = stat.isDirectory() ? '' : path.extname(p);
  const name = stat.isDirectory() ? path.basename(p) : path.basename(p, ext);
  const backup = path.join(dir, `${name}.backup.${ts}${ext}`);
  if (stat.isDirectory()) copyDir(p, backup);
  else fs.copyFileSync(p, backup);
  vlog(`Backed up to ${backup}`);
  return backup;
}

function copyFile(src, dest) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dest);
  vlog(`Copied ${src} → ${dest}`);
}

try {
  if (args.includes('--help')) {
    log(`Usage: install.js [target-dir] [options]\nOptions:\n  --backup\n  --verbose\n  --help`);
    process.exit(0);
  }

  const absTarget = path.resolve(targetDir);
  const absStaging = path.resolve(STAGING);

  vlog(`Target: ${absTarget}`);
  if (!fs.existsSync(absStaging)) throw new Error(`Staging not found: ${absStaging}`);

  const installed = [], backups = [];

  for (const item of FILES) {
    const src = path.join(absStaging, item.src);
    const dest = path.join(absTarget, item.dest);

    if (!fs.existsSync(src)) throw new Error(`Source not found: ${src}`);

    if (fs.existsSync(dest)) {
      if (!backup) throw new Error(`${dest} exists. Use --backup or remove manually.`);
      const bkp = backupFile(dest);
      if (bkp) backups.push(bkp);
      fs.rmSync(dest, { recursive: true, force: true });
      vlog(`Removed ${dest}`);
    }

    if (item.isDir) {
      copyDir(src, dest);
      if (!fs.existsSync(dest)) throw new Error(`Dir copy failed: ${dest}`);
    } else {
      copyFile(src, dest);
      const srcSize = fs.statSync(src).size;
      const destSize = fs.statSync(dest).size;
      if (srcSize !== destSize) throw new Error(`Size mismatch: ${dest}`);
    }

    installed.push(dest);
  }

  log(`\n✓ Installation successful\n`);
  log(`Installed files:`);
  for (const file of installed) log(`  ${path.relative(absTarget, file)}`);
  if (backups.length > 0) {
    log(`\nBackups:`);
    for (const b of backups) log(`  ${path.relative(absTarget, b)}`);
  }
  log(`\nTarget: ${absTarget}`);
  process.exit(0);

} catch (err) {
  console.error(`\n✗ Failed\n\nError: ${err.message}\n`);
  if (err.code === 'EACCES') console.error(`Permission denied.\n`);
  else if (err.code === 'ENOENT') console.error(`File not found.\n`);
  process.exit(1);
}
