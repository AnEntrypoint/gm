#!/usr/bin/env bun

if (process.env.AGENTGUI_SUBPROCESS === '1') {
  console.log(JSON.stringify({ additionalContext: '' }));
  process.exit(0);
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const TOOLS_DIR = path.join(os.homedir(), '.claude', 'gm-tools');

function localBin(name) {
  const ext = IS_WIN ? '.exe' : '';
  return path.join(TOOLS_DIR, 'node_modules', '.bin', name + ext);
}

function runLocal(name, args, opts = {}) {
  const bin = localBin(name);
  if (fs.existsSync(bin)) {
    return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
  }
  return spawnSync('bun', ['x', name, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
}

function plugkitBin() { return path.join(TOOLS_DIR, IS_WIN ? 'plugkit.exe' : 'plugkit'); }

function runPlugkit(args, opts = {}) {
  const bin = plugkitBin();
  if (fs.existsSync(bin)) {
    return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
  }
  return spawnSync('plugkit', args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
}

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

function walkFiles(dir, exts, depth) {
  if (depth <= 0 || !fs.existsSync(dir)) return [];
  let results = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('.') || f === 'node_modules') continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) results = results.concat(walkFiles(full, exts, depth - 1));
      else if (exts.some(e => f.endsWith(e))) results.push({ path: full, mtime: stat.mtimeMs });
    }
  } catch (_) {}
  return results;
}

function getLangPluginContext(dir) {
  const plugins = loadLangPlugins(dir);
  if (!plugins.length) return '';
  const parts = [];
  for (const p of plugins) {
    if (p.context) {
      const ctx = typeof p.context === 'function' ? p.context() : p.context;
      if (ctx) parts.push(String(ctx).slice(0, 2000));
    }
    if (p.lsp && p.extensions && p.extensions.length) {
      try {
        const files = walkFiles(dir, p.extensions, 4)
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 3);
        const diags = [];
        for (const f of files) {
          try {
            const code = fs.readFileSync(f.path, 'utf-8');
            const results = p.lsp.check(code, dir);
            if (Array.isArray(results)) {
              for (const d of results) diags.push(`${path.relative(dir, f.path)}:${d.line}:${d.col}: ${d.severity}: ${d.message}`);
            }
          } catch (_) {}
        }
        if (diags.length) parts.push(`=== ${p.id} LSP diagnostics ===\n${diags.join('\n').slice(0, 3000)}`);
      } catch (_) {}
    }
  }
  return parts.join('\n\n');
}

const ensureGitignore = () => {
  if (!projectDir) return;
  const gitignorePath = path.join(projectDir, '.gitignore');
  const entry = '.gm-stop-verified';
  try {
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    if (!content.split('\n').some(line => line.trim() === entry)) {
      content = (content.endsWith('\n') || content === '' ? content : content + '\n') + entry + '\n';
      fs.writeFileSync(gitignorePath, content);
    }
  } catch (e) {}
};

const runThorns = () => {
  if (!projectDir || !fs.existsSync(projectDir)) return '';
  try {
    const r = runPlugkit(['codeinsight', projectDir], { timeout: 15000 });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    return out ? `=== codeinsight ===\n${out}` : '';
  } catch (e) {
    return '';
  }
};

const runCodeSearch = (prompt) => {
  if (!prompt || !projectDir) return '';
  try {
    const r = runPlugkit(['search', '--path', projectDir, prompt], { timeout: 10000, cwd: projectDir });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    return out ? `=== search ===\n${out}` : '';
  } catch (e) {
    return '';
  }
};

const emit = (additionalContext) => {
  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PROJECT_DIR !== undefined;
  const isKilo = process.env.KILO_PROJECT_DIR !== undefined;
  if (isGemini) {
    console.log(JSON.stringify({ systemMessage: additionalContext }, null, 2));
  } else if (isOpenCode || isKilo) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'message.updated', additionalContext } }, null, 2));
  } else {
    console.log(JSON.stringify({ additionalContext }, null, 2));
  }
};

try {
  let prompt = '';
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
    prompt = input.prompt || input.message || input.userMessage || '';
  } catch (e) {}

  ensureGitignore();

  const parts = [];
  parts.push('Use the Skill tool with skill: "gm" to begin — do NOT use the Agent tool to load skills. Skills are invoked via the Skill tool only, never as agents. DO NOT use EnterPlanMode.');

  const search = runCodeSearch(prompt);
  if (search) parts.push(search);

  const thorns = runThorns();
  if (thorns) parts.push(thorns);

  const langCtx = getLangPluginContext(projectDir);
  if (langCtx) parts.push(langCtx);

  emit(parts.join('\n\n'));
} catch (error) {
  emit('Invoke the `gm` skill to begin. Hook error: ' + error.message);
  process.exit(0);
}
