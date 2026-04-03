#!/usr/bin/env node
'use strict';

const { execSync, spawnSync } = require('child_process');

const REPOS = {
  'rs-exec':       'AnEntrypoint/rs-exec',
  'rs-codeinsight':'AnEntrypoint/rs-codeinsight',
  'rs-search':     'AnEntrypoint/rs-search',
  'rs-plugkit':    'AnEntrypoint/rs-plugkit',
  'plugforge':     'AnEntrypoint/plugforge',
  'gm-cc':         'AnEntrypoint/gm-cc',
};

const POLL_MS = 20000;
const TIMEOUT_MS = 30 * 60 * 1000;

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim() || `gh ${args.join(' ')} failed`);
  return r.stdout.trim();
}

function latestRun(repo) {
  const out = gh(['run', 'list', '--repo', repo, '--limit', '1', '--json', 'databaseId,status,conclusion,name,headBranch,createdAt']);
  const rows = JSON.parse(out);
  return rows[0] || null;
}

function getGmCcSha() {
  return gh(['api', 'repos/AnEntrypoint/gm-cc/git/refs/heads/main', '--jq', '.object.sha']);
}

function getInstalledSha() {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const base = path.join(os.homedir(), '.claude/plugins/cache/gm-cc/gm');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter(d => /^[0-9a-f]{12,}$/.test(d));
  dirs.sort((a, b) => {
    try {
      const av = JSON.parse(fs.readFileSync(path.join(base, a, 'gm.json'), 'utf8')).version || '0';
      const bv = JSON.parse(fs.readFileSync(path.join(base, b, 'gm.json'), 'utf8')).version || '0';
      return bv.localeCompare(av, undefined, { numeric: true });
    } catch { return 0; }
  });
  if (!dirs[0]) return null;
  const gm = JSON.parse(fs.readFileSync(path.join(base, dirs[0], 'gm.json'), 'utf8'));
  return { hash: dirs[0], version: gm.version, plugkitVersion: gm.plugkitVersion };
}

function getPlugkitVersion() {
  const fs = require('fs');
  const cargo = 'C:/dev/rs-plugkit/Cargo.toml';
  if (!fs.existsSync(cargo)) return null;
  const m = fs.readFileSync(cargo, 'utf8').match(/^version\s*=\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

function validate(label, fn) {
  try {
    const result = fn();
    console.log(`  ✓ ${label}: ${result}`);
    return true;
  } catch (e) {
    console.log(`  ✗ ${label}: ${e.message}`);
    return false;
  }
}

async function watchRun(repo, runId, label) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const out = gh(['run', 'view', String(runId), '--repo', repo, '--json', 'status,conclusion']);
    const { status, conclusion } = JSON.parse(out);
    process.stdout.write(`\r  ${label}: ${status} ${conclusion || ''}    `);
    if (status === 'completed') {
      process.stdout.write('\n');
      if (conclusion !== 'success') throw new Error(`${label} concluded: ${conclusion}`);
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${label} timed out after ${TIMEOUT_MS / 60000}min`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForNewRun(repo, label, afterTime, maxWaitMs = 5 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const run = latestRun(repo);
    if (run && new Date(run.createdAt).getTime() > afterTime) return run;
    process.stdout.write(`\r  Waiting for ${label} run to appear...    `);
    await sleep(POLL_MS);
  }
  process.stdout.write('\n');
  throw new Error(`No new run appeared in ${repo} within ${maxWaitMs / 60000}min`);
}

async function main() {
  const triggerTime = Date.now();

  console.log('\n=== Cascade Watcher ===');
  console.log('Monitoring full pipeline: rs-{exec,codeinsight,search} → rs-plugkit → plugforge → gm-cc\n');

  console.log('[1] Baseline');
  const baseGmCcSha = getGmCcSha();
  const baseInstalled = getInstalledSha();
  const basePlugkitVersion = getPlugkitVersion();
  console.log(`  gm-cc HEAD:       ${baseGmCcSha}`);
  console.log(`  installed hash:   ${baseInstalled ? baseInstalled.hash : 'unknown'} (gm v${baseInstalled?.version}, plugkit v${baseInstalled?.plugkitVersion})`);
  console.log(`  local plugkit:    v${basePlugkitVersion}`);

  console.log('\n[2] rs-plugkit Release run');
  const plugkitRun = await waitForNewRun('AnEntrypoint/rs-plugkit', 'rs-plugkit Release', triggerTime - 10 * 60 * 1000);
  console.log(`  Run #${plugkitRun.databaseId} "${plugkitRun.name}" on ${plugkitRun.headBranch}`);
  await watchRun('AnEntrypoint/rs-plugkit', plugkitRun.databaseId, 'rs-plugkit Release');

  console.log('\n[3] Validate rs-plugkit version bumped');
  validate('rs-plugkit Cargo.toml version', () => {
    const v = getPlugkitVersion();
    if (!v) throw new Error('Could not read');
    return `v${v}`;
  });

  validate('plugforge-starter/gm.json plugkitVersion', () => {
    const fs = require('fs');
    const p = 'C:/dev/plugforge/plugforge-starter/gm.json';
    if (!fs.existsSync(p)) throw new Error('file not found');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return `v${j.plugkitVersion}`;
  });

  console.log('\n[4] plugforge Build & Publish run');
  const afterPlugkit = Date.now();
  const pfRun = await waitForNewRun('AnEntrypoint/plugforge', 'plugforge Build & Publish', afterPlugkit - 3 * 60 * 1000);
  console.log(`  Run #${pfRun.databaseId} "${pfRun.name}" on ${pfRun.headBranch}`);
  await watchRun('AnEntrypoint/plugforge', pfRun.databaseId, 'plugforge Build & Publish');

  console.log('\n[5] Validate gm-cc updated');
  const newGmCcSha = getGmCcSha();
  validate('gm-cc HEAD changed', () => {
    if (newGmCcSha === baseGmCcSha) throw new Error(`still ${baseGmCcSha}`);
    return newGmCcSha;
  });

  console.log('\n[6] Validate local installed plugin (requires /plugin + /reload-plugins)');
  const installed = getInstalledSha();
  validate('installed hash matches gm-cc HEAD prefix', () => {
    if (!installed) throw new Error('no installed plugin found');
    if (!newGmCcSha.startsWith(installed.hash)) throw new Error(`installed ${installed.hash} != gm-cc ${newGmCcSha.slice(0, 12)}`);
    return `${installed.hash} (gm v${installed.version}, plugkit v${installed.plugkitVersion})`;
  });

  console.log('\n=== Cascade complete ===');
  console.log(`  gm-cc: ${baseGmCcSha.slice(0, 12)} → ${newGmCcSha.slice(0, 12)}`);
  if (installed && newGmCcSha.startsWith(installed.hash)) {
    console.log('  Local plugin is up to date.');
  } else {
    console.log('  ⚠  Run /plugin then /reload-plugins to update local cache.');
  }
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
