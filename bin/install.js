#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const readline = require('readline');

function out(msg) { process.stdout.write(msg + '\n'); }
function err(msg) { process.stderr.write(msg + '\n'); }

function discoverBundledSkills() {
  const roots = [
    path.join(__dirname, '..', 'skills'),
    path.join(__dirname, '..', '..', 'skills'),
  ];
  const root = roots.find(r => { try { return fs.existsSync(r) && fs.statSync(r).isDirectory(); } catch (_) { return false; } });
  if (!root) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => { try { return fs.existsSync(path.join(root, name, 'SKILL.md')); } catch (_) { return false; } })
      .sort();
  } catch (_) { return []; }
}

function parseArgs(argv) {
  const flags = { yes: false, project: false, help: false };
  for (const a of argv) {
    if (a === '-y' || a === '--yes' || a === '--non-interactive') flags.yes = true;
    else if (a === '--project') flags.project = true;
    else if (a === '-h' || a === '--help') flags.help = true;
  }
  return flags;
}

function homeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function bundledSkillDir(skillName) {
  const candidates = [
    path.join(__dirname, '..', 'skills', skillName),
    path.join(__dirname, '..', '..', 'skills', skillName),
  ];
  return candidates.find(p => { try { return fs.existsSync(path.join(p, 'SKILL.md')); } catch (_) { return false; } }) || null;
}

function detectClaudeCode(home) {
  try { return fs.existsSync(path.join(home, '.claude')); } catch (_) { return false; }
}

function detectAgentsHost(home) {
  try { return fs.existsSync(path.join(home, '.agents')); } catch (_) { return false; }
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function installSkillDir(skillSrc, skillName, home, projectScope) {
  const installed = [];
  const roots = projectScope
    ? [path.join(process.cwd(), '.claude', 'skills', skillName)]
    : [path.join(home, '.claude', 'skills', skillName), path.join(home, '.agents', 'skills', skillName)];
  for (const root of roots) {
    const legacy = path.join(path.dirname(root), 'gm-skill');
    try { if (fs.existsSync(legacy)) fs.rmSync(legacy, { recursive: true, force: true }); } catch (_) {}
    try {
      if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
      copyTree(skillSrc, root);
      installed.push(root);
    } catch (e) {
      err(`failed to install skill to ${root}: ${e.message}`);
    }
  }
  return installed;
}

function seedGlobalMemory(home) {
  const memPath = path.join(home, '.claude', 'CLAUDE.md');
  const line = 'Always use the gm skill (/gm) to drive non-trivial coding tasks.';
  try {
    let cur = '';
    if (fs.existsSync(memPath)) cur = fs.readFileSync(memPath, 'utf8');
    if (cur.split(/\r?\n/).some(l => l.trim() === line)) return false;
    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    const sep = cur && !cur.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(memPath, cur + sep + line + '\n');
    return true;
  } catch (_) { return false; }
}

function readSettings(settingsPath) {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return { obj: JSON.parse(raw), existed: true, corrupt: false };
  } catch (e) {
    if (e.code === 'ENOENT') return { obj: {}, existed: false, corrupt: false };
    return { obj: {}, existed: true, corrupt: true };
  }
}

function applyClaudeSettings(home) {
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const { obj, existed, corrupt } = readSettings(settingsPath);
  if (corrupt) {
    const backup = settingsPath + '.bak';
    try { fs.copyFileSync(settingsPath, backup); } catch (_) {}
    err(`existing settings.json was malformed; backed up to ${backup} and left untouched (not overwritten with defaults, to avoid discarding your other settings) -- fix the JSON manually, or delete it and re-run to get a fresh settings.json`);
    return { settingsPath, existed, corrupt: true };
  }
  obj.effortLevel = 'low';
  obj.alwaysThinkingEnabled = false;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = settingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, settingsPath);
  return { settingsPath, existed };
}

const SETTINGS_EXPLAINER = [
  'Claude Code settings applied:',
  "  effortLevel        = low       thinking effort lowered",
  '  alwaysThinkingEnabled = false  explicit thinking turned off',
  '',
  'The model will still reason -- gm replaces hidden thinking tokens with reasoning in code:',
  'it forms a hypothesis, runs it as code or a browser probe, and reads the real result.',
  'Reasoning becomes a witnessed execution rather than an unverified internal monologue.',
  'Change any of these back in ~/.claude/settings.json or via /config at any time.',
].join('\n');

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, ans => resolve(ans)));
}

async function offerClaudeSettings(home) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    out('');
    out('Claude Code detected. gm works best with reasoning-in-code rather than hidden thinking tokens.');
    out('Offer to set: effortLevel=low, alwaysThinkingEnabled=false.');
    const ans = (await ask(rl, 'Apply these Claude Code settings now? [y/N] ')).trim().toLowerCase();
    if (ans === 'y' || ans === 'yes') {
      const r = applyClaudeSettings(home);
      out(`Wrote ${r.settingsPath}.`);
      out(SETTINGS_EXPLAINER);
      return true;
    }
    out('Skipped Claude Code settings.');
    return false;
  } finally {
    rl.close();
  }
}

function runPlugkitBootstrap() {
  try {
    const boot = require('../gm-plugkit/bootstrap.js');
    if (boot && typeof boot.bootstrap === 'function') return boot.bootstrap({ silent: true }).then(() => true).catch(() => false);
  } catch (_) {}
  return Promise.resolve(false);
}

// Maps process.platform/process.arch to the exact release-asset basename
// gm-runner's CI (rs-plugkit/.github/workflows/gm-runner.yml) publishes to
// AnEntrypoint/gm-runner-bin -- must stay byte-identical to that workflow's
// `artifact:` matrix values, this is the only other place that name is
// spelled. Returns null for a host combination CI does not build (no crash,
// caller falls back to the existing bun/npx path).
function gmRunnerAssetName() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'win32') {
    if (arch === 'x64') return 'gm-runner-windows-x64.exe';
    if (arch === 'arm64') return 'gm-runner-windows-arm64.exe';
    return null;
  }
  if (plat === 'darwin') {
    if (arch === 'x64') return 'gm-runner-macos-x64';
    if (arch === 'arm64') return 'gm-runner-macos-arm64';
    return null;
  }
  if (plat === 'linux') {
    if (arch === 'x64') return 'gm-runner-linux-x64';
    if (arch === 'arm64') return 'gm-runner-linux-arm64';
    return null;
  }
  return null;
}

// Same mapping as gmRunnerAssetName, for agentplug-runner's own CI
// (AnEntrypoint/agentplug's .github/workflows/release.yml) publishing to
// AnEntrypoint/agentplug-bin -- must stay byte-identical to that workflow's
// `artifact:` matrix values.
function agentplugRunnerAssetName() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'win32') {
    if (arch === 'x64') return 'agentplug-runner-windows-x64.exe';
    if (arch === 'arm64') return 'agentplug-runner-windows-arm64.exe';
    return null;
  }
  if (plat === 'darwin') {
    if (arch === 'x64') return 'agentplug-runner-macos-x64';
    if (arch === 'arm64') return 'agentplug-runner-macos-arm64';
    return null;
  }
  if (plat === 'linux') {
    if (arch === 'x64') return 'agentplug-runner-linux-x64';
    if (arch === 'arm64') return 'agentplug-runner-linux-arm64';
    return null;
  }
  return null;
}

function httpsGetBuffer(url, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 5;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'gm-skill-installer' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('too many redirects fetching ' + url)); return; }
        httpsGetBuffer(res.headers.location, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function gmToolsDir() {
  const home = homeDir();
  return path.join(home, '.gm-tools');
}

// Downloads the platform-matched gm-runner binary from gm-runner-bin's
// GitHub Releases (native runner replacing the bun/node spool-boot path),
// verified against the release's own .sha256 sidecar before the atomic
// rename lands -- same trust model as gm-runner's own
// download::download_and_verify for plugkit.wasm, so a corrupt/partial
// download is never silently accepted. Best-effort: any failure (offline,
// asset missing for this host, network error) resolves false rather than
// throwing, so install never hard-fails over a runner-binary fetch -- the
// bun/npx spool path remains the fallback until remove-node-bun-from-native-path
// lands.
async function downloadGmRunner({ silent } = {}) {
  const assetName = gmRunnerAssetName();
  if (!assetName) {
    if (!silent) err(`gm-runner: no published binary for platform=${process.platform} arch=${process.arch}, skipping native runner install`);
    return false;
  }
  const destDir = gmToolsDir();
  const destPath = path.join(destDir, assetName.endsWith('.exe') ? 'gm-runner.exe' : 'gm-runner');
  try {
    const releaseInfo = JSON.parse((await httpsGetBuffer('https://api.github.com/repos/AnEntrypoint/gm-runner-bin/releases/latest')).toString('utf8'));
    const tag = releaseInfo && releaseInfo.tag_name;
    if (!tag) { if (!silent) err('gm-runner: no releases published yet at AnEntrypoint/gm-runner-bin, skipping'); return false; }
    const base = `https://github.com/AnEntrypoint/gm-runner-bin/releases/download/${tag}`;
    const binUrl = `${base}/${assetName}`;
    const shaUrl = `${binUrl}.sha256`;

    const versionFile = path.join(destDir, 'gm-runner.version');
    if (fs.existsSync(destPath) && fs.existsSync(versionFile)) {
      const installed = fs.readFileSync(versionFile, 'utf8').trim();
      if (installed === tag) { if (!silent) out(`gm-runner ${tag} already installed at ${destPath}`); return true; }
    }

    const [binBuf, shaBuf] = await Promise.all([httpsGetBuffer(binUrl), httpsGetBuffer(shaUrl)]);
    const expectedSha = shaBuf.toString('utf8').trim().split(/\s+/)[0];
    const actualSha = sha256Hex(binBuf);
    if (!expectedSha || actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
      if (!silent) err(`gm-runner: sha256 mismatch downloading ${binUrl} (expected ${expectedSha}, got ${actualSha}), not installing`);
      return false;
    }

    fs.mkdirSync(destDir, { recursive: true });
    const tmp = destPath + '.tmp' + process.pid;
    fs.writeFileSync(tmp, binBuf);
    if (process.platform !== 'win32') { try { fs.chmodSync(tmp, 0o755); } catch (_) {} }
    fs.renameSync(tmp, destPath);
    fs.writeFileSync(versionFile, tag);
    if (!silent) out(`Installed gm-runner ${tag} to ${destPath}`);
    return true;
  } catch (e) {
    if (!silent) err(`gm-runner download skipped: ${e && e.message || e}`);
    return false;
  }
}

// Downloads agentplug-runner (the generic wasm plugin-host runner gm-runner
// is migrating to -- hosts gm.wasm plus optional libsql/bert/treesitter
// plugin wasm modules via a host-mediated plugin_call ABI) from
// agentplug-bin's GitHub Releases, same sha256-sidecar/atomic-rename trust
// model as downloadGmRunner. Installed ALONGSIDE gm-runner, not instead of
// it yet -- cli.js's tryDelegateToRunner prefers agentplug-runner when
// present (it's the same spool ABI, agentplug-runner is a strict superset),
// falling back to gm-runner, falling back to bun/npx, so an agentplug-bin
// download failure (new/unpublished platform, network issue) never
// regresses an install that already had a working gm-runner.
async function downloadAgentplugRunner({ silent } = {}) {
  const assetName = agentplugRunnerAssetName();
  if (!assetName) {
    if (!silent) err(`agentplug-runner: no published binary for platform=${process.platform} arch=${process.arch}, skipping`);
    return false;
  }
  const destDir = gmToolsDir();
  const destPath = path.join(destDir, assetName.endsWith('.exe') ? 'agentplug-runner.exe' : 'agentplug-runner');
  try {
    const releaseInfo = JSON.parse((await httpsGetBuffer('https://api.github.com/repos/AnEntrypoint/agentplug-bin/releases/latest')).toString('utf8'));
    const tag = releaseInfo && releaseInfo.tag_name;
    if (!tag) { if (!silent) err('agentplug-runner: no releases published yet at AnEntrypoint/agentplug-bin, skipping'); return false; }
    const base = `https://github.com/AnEntrypoint/agentplug-bin/releases/download/${tag}`;
    const binUrl = `${base}/${assetName}`;
    const shaUrl = `${binUrl}.sha256`;

    const versionFile = path.join(destDir, 'agentplug-runner.version');
    if (fs.existsSync(destPath) && fs.existsSync(versionFile)) {
      const installed = fs.readFileSync(versionFile, 'utf8').trim();
      if (installed === tag) { if (!silent) out(`agentplug-runner ${tag} already installed at ${destPath}`); return true; }
    }

    const [binBuf, shaBuf] = await Promise.all([httpsGetBuffer(binUrl), httpsGetBuffer(shaUrl)]);
    const expectedSha = shaBuf.toString('utf8').trim().split(/\s+/)[0];
    const actualSha = sha256Hex(binBuf);
    if (!expectedSha || actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
      if (!silent) err(`agentplug-runner: sha256 mismatch downloading ${binUrl} (expected ${expectedSha}, got ${actualSha}), not installing`);
      return false;
    }

    fs.mkdirSync(destDir, { recursive: true });
    const tmp = destPath + '.tmp' + process.pid;
    fs.writeFileSync(tmp, binBuf);
    if (process.platform !== 'win32') { try { fs.chmodSync(tmp, 0o755); } catch (_) {} }
    fs.renameSync(tmp, destPath);
    fs.writeFileSync(versionFile, tag);
    if (!silent) out(`Installed agentplug-runner ${tag} to ${destPath}`);
    return true;
  } catch (e) {
    if (!silent) err(`agentplug-runner download skipped: ${e && e.message || e}`);
    return false;
  }
}

function printHelp() {
  out('gm installer');
  out('');
  out('Usage:');
  out('  npx gm-skill install            interactive install (offers Claude Code settings)');
  out('  npx gm-skill install --yes      non-interactive install (sets Claude Code settings)');
  out('  npx gm-skill install --project  install into ./.claude/skills/ instead of the home dir');
  out('');
  out('Installs bundled skills (gm and wfgy-method) by copying their directories into');
  out('~/.claude/skills/ and ~/.agents/skills/ -- no npx "skills" library required.');
}

async function main() {
  const rawArgs = process.argv.slice(2).filter(a => a !== 'install');
  const flags = parseArgs(rawArgs);
  if (flags.help) { printHelp(); return 0; }

  const home = homeDir();
  if (!home) { err('cannot resolve home directory (HOME/USERPROFILE unset)'); return 1; }

  const nonInteractive = flags.yes || !process.stdin.isTTY;

  let anyInstalled = false;
  for (const skillName of discoverBundledSkills()) {
    const skillSrc = bundledSkillDir(skillName);
    if (!skillSrc) { err(`bundled skill directory skills/${skillName} not found in package`); continue; }
    const installed = installSkillDir(skillSrc, skillName, home, flags.project);
    if (installed.length === 0) { err(`${skillName} skill installation failed`); continue; }
    anyInstalled = true;
    out(`Installed ${skillName} skill to:`);
    for (const p of installed) out('  ' + p);
  }
  if (!anyInstalled) { err('skill installation failed'); return 1; }

  if (!flags.project) {
    if (seedGlobalMemory(home)) out('Seeded global memory line in ~/.claude/CLAUDE.md.');
  }

  const isClaudeCode = detectClaudeCode(home) || (!detectAgentsHost(home));
  if (isClaudeCode) {
    if (nonInteractive) {
      const r = applyClaudeSettings(home);
      out(`Wrote ${r.settingsPath}.`);
      out(SETTINGS_EXPLAINER);
    } else {
      await offerClaudeSettings(home);
    }
  }

  await runPlugkitBootstrap();
  await downloadGmRunner({ silent: false });
  await downloadAgentplugRunner({ silent: false });

  out('');
  out('Done. Open Claude Code and run /gm. New top-level skill dirs may need one restart to register.');
  return 0;
}

main().then(code => process.exit(code)).catch(e => { err('install failed: ' + (e && e.message || e)); process.exit(1); });
