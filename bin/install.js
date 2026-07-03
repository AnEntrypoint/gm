#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const SKILL_NAME = 'gm';

function out(msg) { process.stdout.write(msg + '\n'); }
function err(msg) { process.stderr.write(msg + '\n'); }

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

function bundledSkillDir() {
  const candidates = [
    path.join(__dirname, '..', 'skills', SKILL_NAME),
    path.join(__dirname, '..', '..', 'skills', SKILL_NAME),
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

function installSkillDir(skillSrc, home, projectScope) {
  const installed = [];
  const roots = projectScope
    ? [path.join(process.cwd(), '.claude', 'skills', SKILL_NAME)]
    : [path.join(home, '.claude', 'skills', SKILL_NAME), path.join(home, '.agents', 'skills', SKILL_NAME)];
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

function printHelp() {
  out('gm installer');
  out('');
  out('Usage:');
  out('  npx gm-skill install            interactive install (offers Claude Code settings)');
  out('  npx gm-skill install --yes      non-interactive install (sets Claude Code settings)');
  out('  npx gm-skill install --project  install into ./.claude/skills/gm instead of the home dir');
  out('');
  out('Installs the gm skill (/gm) by copying its directory into ~/.claude/skills/gm and');
  out('~/.agents/skills/gm -- no npx "skills" library required.');
}

async function main() {
  const rawArgs = process.argv.slice(2).filter(a => a !== 'install');
  const flags = parseArgs(rawArgs);
  if (flags.help) { printHelp(); return 0; }

  const home = homeDir();
  if (!home) { err('cannot resolve home directory (HOME/USERPROFILE unset)'); return 1; }

  const skillSrc = bundledSkillDir();
  if (!skillSrc) { err('bundled skill directory skills/gm not found in package'); return 1; }

  const nonInteractive = flags.yes || !process.stdin.isTTY;

  const installed = installSkillDir(skillSrc, home, flags.project);
  if (installed.length === 0) { err('skill installation failed'); return 1; }
  out('Installed gm skill to:');
  for (const p of installed) out('  ' + p);

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

  out('');
  out('Done. Open Claude Code and run /gm. New top-level skill dirs may need one restart to register.');
  return 0;
}

main().then(code => process.exit(code)).catch(e => { err('install failed: ' + (e && e.message || e)); process.exit(1); });
