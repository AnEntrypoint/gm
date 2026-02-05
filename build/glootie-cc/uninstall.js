#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ITEMS = [
  { path: 'agents/gm.md', isDir: false },
  { path: 'hooks', isDir: true },
  { path: '.mcp.json', isDir: false }
];

const args = process.argv.slice(2);
const targetDir = args.find(a => !a.startsWith('--')) || process.cwd();
const verbose = args.includes('--verbose');

function log(msg) { console.log(msg); }
function vlog(msg) { if (verbose) console.log(`  ${msg}`); }

function removeItem(p) {
  if (!fs.existsSync(p)) {
    vlog(`Not found (already removed): ${p}`);
    return false;
  }
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    fs.rmSync(p, { recursive: true, force: true });
    vlog(`Removed directory: ${p}`);
  } else {
    fs.unlinkSync(p);
    vlog(`Removed file: ${p}`);
  }
  return true;
}

function checkOrphaned(dir) {
  const orphaned = [];
  const agentsDir = path.join(dir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir);
    if (files.length > 0) orphaned.push(`agents/: ${files.join(', ')}`);
  }
  const hooksDir = path.join(dir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    const files = fs.readdirSync(hooksDir);
    if (files.length > 0) orphaned.push(`hooks/: ${files.join(', ')}`);
  }
  return orphaned;
}

try {
  if (args.includes('--help')) {
    log(`Usage: uninstall.js [target-dir] [options]\nOptions:\n  --verbose\n  --help`);
    process.exit(0);
  }

  const absTarget = path.resolve(targetDir);
  vlog(`Target: ${absTarget}`);

  const removed = [];

  for (const item of ITEMS) {
    const p = path.join(absTarget, item.path);
    if (removeItem(p)) {
      if (fs.existsSync(p)) throw new Error(`Failed to remove: ${p}`);
      removed.push(item.path);
    }
  }

  const orphaned = checkOrphaned(absTarget);
  if (orphaned.length > 0) {
    throw new Error(`Orphaned files:\n  ${orphaned.join('\n  ')}`);
  }

  log(`\n✓ Uninstall successful\n`);
  if (removed.length > 0) {
    log(`Removed files:`);
    for (const file of removed) log(`  ${file}`);
  } else {
    log(`No files found to remove.`);
  }
  log(`\nTarget: ${absTarget}`);
  process.exit(0);

} catch (err) {
  console.error(`\n✗ Failed\n\nError: ${err.message}\n`);
  if (err.code === 'EACCES') console.error(`Permission denied.\n`);
  else if (err.code === 'ENOENT') console.error(`File not found.\n`);
  process.exit(1);
}
