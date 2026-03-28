#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const TOOLS_DIR = path.join(os.homedir(), '.claude', 'gm-tools');

function localBin(name) {
  const ext = IS_WIN ? '.exe' : '';
  return path.join(TOOLS_DIR, 'node_modules', '.bin', name + ext);
}

function pkgEntry(name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'node_modules', name, 'package.json'), 'utf8'));
    const binVal = pkg.bin;
    const rel = typeof binVal === 'string' ? binVal : (binVal?.[name] || Object.values(binVal || {})[0]);
    if (rel) return path.join(TOOLS_DIR, 'node_modules', name, rel);
  } catch {}
  return null;
}

function runLocal(name, args, opts = {}) {
  if (IS_WIN) {
    const entry = pkgEntry(name);
    if (entry && fs.existsSync(entry)) {
      return spawnSync('bun', [entry, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
    }
  }
  const bin = localBin(name);
  if (fs.existsSync(bin)) {
    return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
  }
  return spawnSync('bun', ['x', name, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
}

const MANAGED_PKGS = ['agent-browser'];
const PKG_JSON = path.join(TOOLS_DIR, 'package.json');

const PLUGKIT_REPO = 'AnEntrypoint/rs-plugkit';
const plugkitTargets = {
  win32: () => `plugkit.exe`,
  darwin: () => `plugkit`,
  linux: () => `plugkit`,
};

function plugkitBin() { return path.join(TOOLS_DIR, IS_WIN ? 'plugkit.exe' : 'plugkit'); }

function downloadBin(assetPath, dest) {
  const https = require('https');
  const url = `https://github.com/${PLUGKIT_REPO}/releases/latest/download/${assetPath}`;
  return new Promise((resolve) => {
    const follow = (u) => https.get(u, { headers: { 'User-Agent': 'gm' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) return follow(res.headers.location);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { fs.writeFileSync(dest, Buffer.concat(chunks)); fs.chmodSync(dest, 0o755); } catch {} resolve(); });
    }).on('error', () => resolve());
    follow(url);
  });
}

async function ensurePlugkit() {
  const bin = plugkitBin();
  if (!fs.existsSync(bin)) {
    const assetPath = plugkitTargets[process.platform]?.() || plugkitTargets.linux();
    await downloadBin(assetPath, bin);
  }
}

function ensureTools() {
  try { fs.mkdirSync(TOOLS_DIR, { recursive: true }); } catch {}
  if (!fs.existsSync(PKG_JSON)) {
    try { fs.writeFileSync(PKG_JSON, JSON.stringify({ name: 'gm-tools', version: '1.0.0', private: true })); } catch {}
  }
  const missing = MANAGED_PKGS.filter(p => !fs.existsSync(localBin(p)));
  if (missing.length > 0) {
    try {
      spawnSync('bun', ['add', ...missing.map(p => p + '@latest')], {
        cwd: TOOLS_DIR, encoding: 'utf8', timeout: 180000, windowsHide: true
      });
    } catch {}
  }
}

ensureTools();
ensurePlugkit().catch(() => {});

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.env.KILO_PROJECT_DIR;

function loadLangPlugins(dir) {
  if (!dir) return [];
  const langDir = path.join(dir, 'lang');
  if (!fs.existsSync(langDir)) return [];
  try {
    return fs.readdirSync(langDir)
      .filter(f => f.endsWith('.js') && f !== 'loader.js' && f !== 'SPEC.md')
      .reduce((acc, f) => {
        try {
          const p = require(path.join(langDir, f));
          if (p && typeof p.id === 'string' && p.exec && p.exec.match instanceof RegExp && typeof p.exec.run === 'function') acc.push(p);
        } catch (_) {}
        return acc;
      }, []);
  } catch (_) { return []; }
}

function getLangPluginContext(dir) {
  const plugins = loadLangPlugins(dir);
  return plugins
    .filter(p => p.context)
    .map(p => { const ctx = typeof p.context === 'function' ? p.context() : p.context; return ctx ? String(ctx).slice(0, 2000) : ''; })
    .filter(Boolean)
    .join('\n\n');
}

const ensureGitignore = () => {
  if (!projectDir) return;
  const gitignorePath = path.join(projectDir, '.gitignore');
  const entry = '.gm-stop-verified';
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }
    if (!content.split('\n').some(line => line.trim() === entry)) {
      const newContent = content.endsWith('\n') || content === ''
        ? content + entry + '\n'
        : content + '\n' + entry + '\n';
      fs.writeFileSync(gitignorePath, newContent);
    }
  } catch (e) {}
};

ensureGitignore();

try {
  let outputs = [];

  outputs.push('Use the Skill tool with skill: "gm" to begin — do NOT use the Agent tool to load skills. Skills are invoked via the Skill tool only, never as agents. All code execution uses exec:<lang> via the Bash tool — never direct Bash(node ...) or Bash(npm ...) or Bash(npx ...) or Bash(plugkit ...).');

  if (projectDir && fs.existsSync(projectDir)) {
    try {
      const bin = plugkitBin();
      const r = fs.existsSync(bin)
        ? spawnSync(bin, ['codeinsight', projectDir], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
        : spawnSync('plugkit', ['codeinsight', projectDir], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      const insightOutput = ((r.stdout || '') + (r.stderr || '')).trim();
      if (insightOutput) {
        outputs.push(`=== This is your initial insight of the repository, look at every possible aspect of this for initial opinionation and to offset the need for code exploration ===\n${insightOutput}`);
      }
    } catch (e) {}
  }

  const langCtx = getLangPluginContext(projectDir);
  if (langCtx) outputs.push(langCtx);

  const additionalContext = outputs.join('\n\n');

  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;
  const isKilo = process.env.KILO_PLUGIN_ROOT !== undefined;

  if (isGemini) {
    console.log(JSON.stringify({ systemMessage: additionalContext }, null, 2));
  } else if (isOpenCode || isKilo) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'session.created', additionalContext } }, null, 2));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }, null, 2));
  }
} catch (error) {
  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;
  const isKilo = process.env.KILO_PLUGIN_ROOT !== undefined;

  if (isGemini) {
    console.log(JSON.stringify({ systemMessage: `Error executing hook: ${error.message}` }, null, 2));
  } else if (isOpenCode || isKilo) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'session.created', additionalContext: `Error executing hook: ${error.message}` } }, null, 2));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Error executing hook: ${error.message}` } }, null, 2));
  }
  process.exit(0);
}
