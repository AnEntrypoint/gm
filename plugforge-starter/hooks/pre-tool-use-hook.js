#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
const IS_WIN = process.platform === 'win32';

// ─── Local tool management ────────────────────────────────────────────────────
const TOOLS_DIR = path.join(os.homedir(), '.claude', 'gm-tools');
const CHECK_STAMP = path.join(TOOLS_DIR, '.last-check');
const PKG_JSON = path.join(TOOLS_DIR, 'package.json');
const MANAGED_PKGS = ['gm-exec', 'codebasesearch', 'mcp-thorns', 'agent-browser'];
const CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds

function ensureToolsDir() {
  try { fs.mkdirSync(TOOLS_DIR, { recursive: true }); } catch {}
  if (!fs.existsSync(PKG_JSON)) {
    try { fs.writeFileSync(PKG_JSON, JSON.stringify({ name: 'gm-tools', version: '1.0.0', private: true })); } catch {}
  }
}

function localBin(name) {
  const ext = IS_WIN ? '.exe' : '';
  return path.join(TOOLS_DIR, 'node_modules', '.bin', name + ext);
}

function isInstalled(name) {
  return fs.existsSync(localBin(name));
}

function installPkg(name) {
  try {
    spawnSync('bun', ['add', name + '@latest'], {
      cwd: TOOLS_DIR, encoding: 'utf8', timeout: 120000, windowsHide: true
    });
  } catch {}
}

function getInstalledVersion(name) {
  try {
    const p = path.join(TOOLS_DIR, 'node_modules', name, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch { return null; }
}

function getLatestVersion(name) {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const req = https.get(
        `https://registry.npmjs.org/${name}/latest`,
        { headers: { Accept: 'application/json' } },
        (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d).version); } catch { resolve(null); } });
        }
      );
      req.setTimeout(5000, () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    });
  } catch { return Promise.resolve(null); }
}

function shouldCheck() {
  try {
    const t = parseInt(fs.readFileSync(CHECK_STAMP, 'utf8').trim(), 10);
    return isNaN(t) || (Date.now() - t) > CHECK_INTERVAL_MS;
  } catch { return true; }
}

function stampCheck() {
  try { fs.writeFileSync(CHECK_STAMP, String(Date.now())); } catch {}
}

async function ensureTools() {
  ensureToolsDir();
  // Install any missing packages immediately (synchronous first-run)
  const missing = MANAGED_PKGS.filter(p => !isInstalled(p));
  if (missing.length > 0) {
    try {
      spawnSync('bun', ['add', ...missing.map(p => p + '@latest')], {
        cwd: TOOLS_DIR, encoding: 'utf8', timeout: 180000, windowsHide: true
      });
    } catch {}
  }
  // Async version check (non-blocking — fire and forget)
  if (shouldCheck()) {
    stampCheck();
    (async () => {
      for (const name of MANAGED_PKGS) {
        const installed = getInstalledVersion(name);
        if (!installed) { installPkg(name); continue; }
        const latest = await getLatestVersion(name);
        if (latest && latest !== installed) installPkg(name);
      }
    })().catch(() => {});
  }
}

// Run tool installation (fire-and-forget, won't block hook)
ensureTools().catch(() => {});

// ─── Lang plugin loader ───────────────────────────────────────────────────────
function loadLangPlugins(projectDir) {
  if (!projectDir) return [];
  const langDir = path.join(projectDir, 'lang');
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

// Helper: run a local binary (falls back to bunx if not installed)
function runLocal(name, args, opts = {}) {
  const bin = localBin(name);
  if (fs.existsSync(bin)) {
    return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 65000, ...opts });
  }
  // Fallback to bunx
  return spawnSync('bun', ['x', name, ...args], { encoding: 'utf8', windowsHide: true, timeout: 65000, ...opts });
}

// ─── Hook helpers ─────────────────────────────────────────────────────────────
const writeTools = ['Write', 'write_file'];
const searchTools = ['glob', 'search_file_content', 'Search', 'search'];
const forbiddenTools = ['find', 'Find', 'Glob', 'Grep'];

const allow = (additionalContext) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', ...(additionalContext && { additionalContext }) }
});
const deny = (reason) => isGemini
  ? { decision: 'deny', reason }
  : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };

// Write output to tmp file and redirect the Bash command to read+delete it via bun (no popup)
const allowWithNoop = (context) => {
  const tmp = path.join(os.tmpdir(), `gm-out-${Date.now()}.txt`);
  fs.writeFileSync(tmp, context, 'utf-8');
  // Use bun -e to read and print file — windowsHide applies to child, and bun itself is hidden
  // cmd /c type also works without popup since cmd.exe is the host shell
  const cmd = IS_WIN
    ? `bun -e "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'));require('fs').unlinkSync(process.argv[1])" "${tmp}"`
    : `cat '${tmp}'; rm -f '${tmp}'`;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { command: cmd }
    }
  };
};

// ─── gm-exec runner helper ────────────────────────────────────────────────────
function runGmExec(args, opts = {}) {
  const bin = localBin('gm-exec');
  if (fs.existsSync(bin)) {
    return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 65000, ...opts });
  }
  return spawnSync('bun', ['x', 'gm-exec', ...args], { encoding: 'utf8', windowsHide: true, timeout: 65000, ...opts });
}

// ─── Main hook ────────────────────────────────────────────────────────────────
const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;

    if (!tool_name) return allow();

    if (forbiddenTools.includes(tool_name)) {
      return deny('Use the code-search skill for codebase exploration instead of Grep/Glob/find. Describe what you need in plain language — it understands intent, not just patterns.');
    }

    if (writeTools.includes(tool_name)) {
      const file_path = tool_input?.file_path || '';
      const ext = path.extname(file_path);
      const inSkillsDir = file_path.includes('/skills/') || file_path.includes('\\skills\\');
      const base = path.basename(file_path).toLowerCase();
      if ((ext === '.md' || ext === '.txt' || base.startsWith('features_list')) &&
          !base.startsWith('claude') && !base.startsWith('readme') && !inSkillsDir) {
        return deny('Cannot create documentation files. Only CLAUDE.md and readme.md are maintained. For task-specific notes, use .prd. For permanent reference material, add to CLAUDE.md.');
      }
      if (/\.(test|spec)\.(js|ts|jsx|tsx|mjs|cjs)$/.test(base) ||
          /^(jest|vitest|mocha|ava|jasmine|tap)\.(config|setup)/.test(base) ||
          file_path.includes('/__tests__/') || file_path.includes('/test/') ||
          file_path.includes('/tests/') || file_path.includes('/fixtures/') ||
          file_path.includes('/test-data/') || file_path.includes('/__mocks__/') ||
          /\.(snap|stub|mock|fixture)\.(js|ts|json)$/.test(base)) {
        return deny('Test files forbidden on disk. Use Bash tool with real services for all testing.');
      }
    }

    if (searchTools.includes(tool_name)) return allow();

    if (tool_name === 'Task' && (tool_input?.subagent_type || '') === 'Explore') {
      return deny('Use the code-search skill for codebase exploration. Describe what you need in plain language.');
    }

    if (tool_name === 'EnterPlanMode') {
      return deny('Plan mode is disabled. Use the gm skill (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE state machine) instead.');
    }

    if (tool_name === 'Skill') {
      const skill = (tool_input?.skill || '').toLowerCase().replace(/^gm:/, '');
      if (skill === 'explore' || skill === 'search') {
        return deny('Use the code-search skill for codebase exploration. Describe what you need in plain language — it understands intent, not just patterns.');
      }
    }

    if (tool_name === 'Bash') {
      const command = (tool_input?.command || '').trim();
      const stripFooter = (s) => s.replace(/\n\[Running tools\][\s\S]*$/, '').trimEnd();

      if (/^exec:pm2list\s*$/.test(command)) {
        const r = runGmExec(['pm2list']);
        return allowWithNoop(`exec:pm2list output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
      }
      if (/^exec:pm2logs(\s|$)/.test(command)) {
        const args = command.replace(/^exec:pm2logs\s*/, '').trim();
        const pmArgs = args ? ['logs', '--nostream', '--lines', '50', args] : ['logs', '--nostream', '--lines', '50'];
        const r = spawnSync('pm2', pmArgs, { encoding: 'utf-8', timeout: 15000, windowsHide: true });
        return allowWithNoop(`exec:pm2logs output:\n\n${stripFooter((r.stdout || '') + (r.stderr || '')) || '(no logs)'}`);
      }

      const execMatch = command.match(/^exec(?::(\S+))?\n([\s\S]+)$/);
      if (execMatch) {
        const rawLang = (execMatch[1] || '').toLowerCase();
        const code = execMatch[2];
        if (/^\s*agent-browser\s/.test(code)) {
          return deny(`Do not call agent-browser via exec:bash. Use exec:agent-browser instead:\n\nexec:agent-browser\n<plain JS here>\n\nThe code is piped directly to the browser eval. No base64, no flags, no shell wrapping.`);
        }
        const cwd = tool_input?.cwd;

        // ─── Lang plugin dispatch ─────────────────────────────────────────────
        if (rawLang) {
          const builtins = new Set(['js','javascript','ts','typescript','node','nodejs','py','python','sh','bash','shell','zsh','powershell','ps1','go','rust','c','cpp','java','deno','cmd','browser','ab','agent-browser','codesearch','search','status','sleep','close','runner','type','pm2list']);
          if (!builtins.has(rawLang)) {
            const plugins = loadLangPlugins(projectDir);
            const plugin = plugins.find(p => p.exec.match.test(`exec:${rawLang}\n${code}`));
            if (plugin) {
              const runnerCode = `
                const plugin = require(${JSON.stringify(path.join(projectDir, 'lang', plugin.id + '.js'))});
                Promise.resolve(plugin.exec.run(${JSON.stringify(code)}, ${JSON.stringify(cwd || projectDir || process.cwd())}))
                  .then(out => process.stdout.write(String(out || '')))
                  .catch(e => { process.stderr.write(e.message || String(e)); process.exit(1); });
              `;
              const r = spawnSync('bun', ['-e', runnerCode], { encoding: 'utf-8', timeout: 30000, windowsHide: true });
              const out = (r.stdout || '').trimEnd();
              const err = (r.stderr || '').trimEnd();
              if (r.status !== 0 || r.error) return allowWithNoop(`exec:${rawLang} error:\n\n${r.error ? r.error.message : (err || 'exec failed')}`);
              return allowWithNoop(`exec:${rawLang} output:\n\n${out || '(no output)'}`);
            }
          }
        }
        // ─────────────────────────────────────────────────────────────────────
        const detectLang = (src) => {
          if (/^\s*(import |from |export |const |let |var |function |class |async |await |console\.|process\.)/.test(src)) return 'nodejs';
          if (/^\s*(import |def |print\(|class |if __name__)/.test(src)) return 'python';
          if (/^\s*(echo |ls |cd |mkdir |rm |cat |grep |find |export |source |#!)/.test(src)) return 'bash';
          return 'nodejs';
        };
        // Note: 'cmd' is NOT aliased to 'bash' — it has its own handler below
        const aliases = { js: 'nodejs', javascript: 'nodejs', ts: 'typescript', node: 'nodejs', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', powershell: 'powershell', ps1: 'powershell', browser: 'agent-browser', ab: 'agent-browser', codesearch: 'codesearch', search: 'search', status: 'status', sleep: 'sleep', close: 'close', runner: 'runner', type: 'type', pm2list: 'pm2list' };
        const lang = aliases[rawLang] || rawLang || detectLang(code);
        const langExts = { nodejs: 'mjs', typescript: 'ts', deno: 'ts', python: 'py', bash: 'sh', powershell: 'ps1', go: 'go', rust: 'rs', c: 'c', cpp: 'cpp', java: 'java' };

        const spawnDirect = (bin, args, stdin) => {
          const opts = { encoding: 'utf-8', timeout: 60000, windowsHide: true, ...(cwd && { cwd }), ...(stdin !== undefined && { input: stdin }) };
          const r = spawnSync(bin, args, opts);
          if (!r.stdout && !r.stderr && r.error) return `[spawn error: ${r.error.message}]`;
          const out = (r.stdout || '').trimEnd(), err = stripFooter(r.stderr || '').trimEnd();
          return out && err ? out + '\n[stderr]\n' + err : stripFooter(out || err);
        };

        const runWithFile = (l, src) => {
          const tmp = path.join(os.tmpdir(), `gm-exec-${Date.now()}.${langExts[l] || l}`);
          fs.writeFileSync(tmp, src, 'utf-8');
          const r = runGmExec(['exec', `--lang=${l}`, `--file=${tmp}`, ...(cwd ? [`--cwd=${cwd}`] : [])], { timeout: 65000 });
          try { fs.unlinkSync(tmp); } catch (e) {}
          let out = stripFooter((r.stdout || '') + (r.stderr || ''));
          const bg = out.match(/Task ID:\s*(task_\S+)/);
          if (bg) {
            runGmExec(['sleep', bg[1], '60'], { timeout: 70000 });
            const sr = runGmExec(['status', bg[1]], { timeout: 15000 });
            out = stripFooter((sr.stdout || '') + (sr.stderr || ''));
            runGmExec(['close', bg[1]], { timeout: 10000 });
          }
          return out;
        };

        const decodeB64 = (s) => {
          const t = s.trim();
          if (t.length < 16 || t.length % 4 !== 0 || !/^[A-Za-z0-9+/\r\n]+=*$/.test(t)) return s;
          try { const d = Buffer.from(t, 'base64').toString('utf-8'); return /[\x00-\x08\x0b\x0e-\x1f]/.test(d) ? s : d; } catch { return s; }
        };

        const safeCode = decodeB64(code);

        if (['codesearch', 'search'].includes(lang)) {
          const query = safeCode.trim();
          const r = runLocal('codebasesearch', [query], { timeout: 30000, ...(cwd && { cwd }) });
          return allowWithNoop(`exec:${lang} output:\n\n${stripFooter((r.stdout || '') + (r.stderr || '')) || '(no results)'}`);
        }
        if (lang === 'status') {
          const r = runGmExec(['status', safeCode.trim()], { timeout: 15000 });
          return allowWithNoop(`exec:status output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        if (lang === 'sleep') {
          const parts = safeCode.trim().split(/\s+/);
          const r = runGmExec(['sleep', ...parts], { timeout: 70000 });
          return allowWithNoop(`exec:sleep output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        if (lang === 'close') {
          const r = runGmExec(['close', safeCode.trim()], { timeout: 15000 });
          return allowWithNoop(`exec:close output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        if (lang === 'runner') {
          const r = runGmExec(['runner', safeCode.trim()], { timeout: 15000 });
          return allowWithNoop(`exec:runner output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        if (lang === 'type') {
          const lines = safeCode.split(/\r?\n/);
          const taskId = lines[0].trim();
          const inputData = lines.slice(1).join('\n').trim();
          const r = runGmExec(['type', taskId, inputData], { timeout: 15000 });
          return allowWithNoop(`exec:type output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        if (lang === 'pm2list') {
          const r = runGmExec(['pm2list'], { timeout: 15000 });
          return allowWithNoop(`exec:pm2list output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }

        try {
          let result;
          if (lang === 'bash') {
            const shFile = path.join(os.tmpdir(), `gm-exec-${Date.now()}.sh`);
            fs.writeFileSync(shFile, safeCode, 'utf-8');
            result = spawnDirect('bash', [shFile]);
            try { fs.unlinkSync(shFile); } catch (e) {}
            if (!result || result.startsWith('[spawn error:')) result = runWithFile('bash', safeCode);
          } else if (lang === 'cmd') {
            // exec:cmd always runs cmd.exe /c — explicit Windows command prompt
            result = spawnDirect('cmd.exe', ['/c', safeCode]);
            if (!result || result.startsWith('[spawn error:')) result = runWithFile('cmd', safeCode);
            return allowWithNoop(`exec:cmd output:\n\n${result || '(no output)'}`);
          } else if (lang === 'python') {
            result = spawnDirect('python3', ['-c', safeCode]);
            if (!result || result.startsWith('[spawn error:')) result = spawnDirect('python', ['-c', safeCode]);
          } else if (!lang || ['nodejs', 'typescript', 'deno'].includes(lang)) {
            const wrapped = `const __result = await (async () => {\n${safeCode}\n})();\nif (__result !== undefined) { if (typeof __result === 'object') { console.log(JSON.stringify(__result, null, 2)); } else { console.log(__result); } }`;
            result = runWithFile(lang || 'nodejs', wrapped);
          } else if (lang === 'agent-browser') {
            const abBin = localBin('agent-browser');
            if (fs.existsSync(abBin)) {
              result = spawnDirect(abBin, ['eval', '--stdin'], safeCode);
            } else {
              result = spawnDirect('agent-browser', ['eval', '--stdin'], safeCode);
            }
          } else {
            result = runWithFile(lang, safeCode);
          }
          return allowWithNoop(`exec:${lang} output:\n\n${result || '(no output)'}`);
        } catch (e) {
          return allowWithNoop(`exec:${lang} error:\n\n${(e.stdout || '') + (e.stderr || '') || e.message || '(exec failed)'}`);
        }
      }

      if (!/^exec(\s|:)/.test(command) && !/^bun x gm-exec(@[^\s]*)?(\s|$)/.test(command) && !/^git /.test(command) && !/^bun x codebasesearch/.test(command) && !/(\bclaude\b)/.test(command) && !/^npm install .* \/config\/.gmweb/.test(command) && !/^bun install --cwd \/config\/.gmweb/.test(command)) {
        let helpText = '';
        try { helpText = '\n\n' + execSync(`"${localBin('gm-exec')}" --help`, { timeout: 10000, windowsHide: true }).toString().trim(); } catch (e) {
          try { helpText = '\n\n' + execSync('bun x gm-exec --help', { timeout: 10000, windowsHide: true }).toString().trim(); } catch {}
        }
        return deny(`Bash is restricted to exec:<lang> and git.\n\nexec:<lang> syntax (lang auto-detected if omitted):\n  exec:nodejs / exec:python / exec:bash / exec:typescript\n  exec:go / exec:rust / exec:java / exec:c / exec:cpp\n  exec:cmd            ← runs cmd.exe /c on Windows\n  exec:agent-browser  ← plain JS piped to browser eval (NO base64)\n  exec               ← auto-detects language\n\nTask management shortcuts (body = args):\n  exec:status\n  <task_id>\n\n  exec:sleep\n  <task_id> [seconds] [--next-output]\n\n  exec:type\n  <task_id>\n  <input to send to stdin>\n\n  exec:close\n  <task_id>\n\n  exec:runner\n  start|stop|status\n\nCode search shortcut:\n  exec:codesearch\n  <natural language query>\n\nNEVER encode agent-browser code as base64 — pass plain JS directly.\n\nbun x gm-exec${helpText}\n\nAll other Bash commands are blocked.`);
      }
    }

    const allowedTools = ['agent-browser', 'Skill', 'code-search', 'electron', 'TaskOutput', 'ReadMcpResourceTool', 'ListMcpResourcesTool'];
    if (allowedTools.includes(tool_name)) return allow();

    return allow();
  } catch (error) {
    return allow();
  }
};

try {
  const result = run();
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (error) {
  process.exit(0);
}
