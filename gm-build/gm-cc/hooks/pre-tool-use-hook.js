#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
const IS_WIN = process.platform === 'win32';
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.env.KILO_PROJECT_DIR;

// ─── Local tool management ────────────────────────────────────────────────────
const TOOLS_DIR = path.join(os.homedir(), '.claude', 'gm-tools');
const CHECK_STAMP = path.join(TOOLS_DIR, '.last-check');
const PKG_JSON = path.join(TOOLS_DIR, 'package.json');
const MANAGED_PKGS = ['agent-browser'];
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
      return spawnSync('bun', [entry, ...args], { encoding: 'utf8', windowsHide: true, timeout: 65000, ...opts });
    }
  }
  const bin = localBin(name);
  if (fs.existsSync(bin)) {
    return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 65000, ...opts });
  }
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

// ─── plugkit runner helper ────────────────────────────────────────────────────
function plugkitBin() { return path.join(TOOLS_DIR, IS_WIN ? 'plugkit.exe' : 'plugkit'); }

function runGmExec(args, opts = {}) {
  const bin = plugkitBin();
  if (fs.existsSync(bin)) {
    return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 65000, ...opts });
  }
  return spawnSync('plugkit', args, { encoding: 'utf8', windowsHide: true, timeout: 65000, ...opts });
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

      // ─── agent-browser: CLI commands ──────────────────────────────────────────
      const abCliMatch = command.match(/^agent-browser:\n([\s\S]+)$/);
      if (abCliMatch) {
        const abCode = abCliMatch[1];
        const abNative = (() => {
          const abDir = path.join(TOOLS_DIR, 'node_modules', 'agent-browser', 'bin');
          const ext = IS_WIN ? '.exe' : '';
          const archMap = { x64: 'x64', arm64: 'arm64', ia32: 'x64' };
          const osMap = { win32: 'win32', darwin: 'darwin', linux: 'linux' };
          const candidate = path.join(abDir, `agent-browser-${osMap[process.platform] || process.platform}-${archMap[process.arch] || process.arch}${ext}`);
          return fs.existsSync(candidate) ? candidate : null;
        })();
        const abBin = abNative || (fs.existsSync(localBin('agent-browser')) ? localBin('agent-browser') : 'agent-browser');
        const AB_CMDS = new Set(['open','goto','navigate','close','quit','exit','back','forward','reload','click','dblclick','type','fill','press','check','uncheck','select','drag','upload','hover','focus','scroll','scrollintoview','wait','screenshot','pdf','snapshot','get','is','find','eval','connect','tab','frame','dialog','state','session','network','cookies','storage','set','trace','profiler','record','console','errors','highlight','inspect','diff','keyboard','mouse','install','upgrade','confirm','deny','auth','device','window']);
        const AB_GLOBAL_FLAGS = new Set(['--cdp','--headed','--headless','--session','--session-name','--auto-connect','--profile','--allow-file-access','--color-scheme','-p','--platform','--device']);
        const AB_GLOBAL_FLAGS_WITH_VALUE = new Set(['--cdp','--session','--session-name','--profile','--color-scheme','-p','--platform','--device']);
        const AB_SESSION_STATE = path.join(os.tmpdir(), 'gm-ab-sessions.json');
        function readAbSessions() { try { return JSON.parse(fs.readFileSync(AB_SESSION_STATE, 'utf8')); } catch { return {}; } }
        function writeAbSessions(s) { try { fs.writeFileSync(AB_SESSION_STATE, JSON.stringify(s)); } catch {} }
        function parseAbLine(line) {
          const tokens = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
          const globalArgs = [], rest = [];
          let i = 0;
          while (i < tokens.length) {
            if (AB_GLOBAL_FLAGS.has(tokens[i])) {
              globalArgs.push(tokens[i]);
              if (AB_GLOBAL_FLAGS_WITH_VALUE.has(tokens[i]) && i + 1 < tokens.length && !tokens[i+1].startsWith('--')) globalArgs.push(tokens[++i]);
              i++;
            } else { rest.push(...tokens.slice(i)); break; }
          }
          return { globalArgs, rest };
        }
        const spawnAb = (bin, args, stdin) => {
          const headed = args.includes('--headed');
          const opts = { encoding: 'utf-8', timeout: 60000, windowsHide: !headed, ...(IS_WIN && { shell: true }), cwd: process.cwd(), ...(stdin !== undefined && { input: stdin }) };
          const r = spawnSync(bin, args, opts);
          if (!r.stdout && !r.stderr && r.error) return `[spawn error: ${r.error.message}]`;
          const out = (r.stdout || '').trimEnd(), err = stripFooter(r.stderr || '').trimEnd();
          return out && err ? out + '\n[stderr]\n' + err : stripFooter(out || err);
        };
        try {
          const safeAb = abCode.trim();
          const firstParsed = parseAbLine(safeAb.split('\n')[0].trim());
          const firstWord = (firstParsed.rest[0] || '').toLowerCase();
          const sessionName = (() => { const si = firstParsed.globalArgs.indexOf('--session'); return si >= 0 ? firstParsed.globalArgs[si+1] : 'default'; })();
          const sessions = readAbSessions();
          if (['open','goto','navigate'].includes(firstWord)) sessions[sessionName] = { url: firstParsed.rest[1] || '?', ts: Date.now() };
          if (['close','quit','exit'].includes(firstWord)) delete sessions[sessionName];
          writeAbSessions(sessions);
          const openSessions = Object.entries(sessions);
          let result;
          if (AB_CMDS.has(firstWord)) {
            const lines = safeAb.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length === 1) {
              const { globalArgs, rest } = parseAbLine(lines[0]);
              result = spawnAb(abBin, [...globalArgs, ...rest]);
            } else {
              const hasClose = lines.some(l => { const w = (parseAbLine(l).rest[0]||'').toLowerCase(); return ['close','quit','exit'].includes(w); });
              const batchGlobals = firstParsed.globalArgs;
              const results = [];
              for (const l of lines) {
                const { globalArgs, rest } = parseAbLine(l);
                const mergedGlobals = [...batchGlobals.filter(f => !globalArgs.includes(f)), ...globalArgs];
                const w = (rest[0]||'').toLowerCase();
                if (['open','goto','navigate'].includes(w)) sessions[sessionName] = { url: rest[1]||'?', ts: Date.now() };
                if (['close','quit','exit'].includes(w)) delete sessions[sessionName];
                const args = AB_CMDS.has(w) ? [...mergedGlobals, ...rest] : [...mergedGlobals, 'eval', '--stdin'];
                const stdin = AB_CMDS.has(w) ? undefined : l.trim();
                results.push(spawnAb(abBin, args, stdin));
              }
              writeAbSessions(sessions);
              result = results.filter(Boolean).join('\n');
              if (!hasClose && openSessions.length > 0) result += `\n\n[tab] Browser session "${sessionName}" still open. Close when done:\n  agent-browser:\n  close`;
            }
          } else {
            result = spawnAb(abBin, ['eval', '--stdin'], safeAb);
          }
          if (openSessions.length > 1) {
            const stale = openSessions.filter(([n]) => n !== sessionName).map(([n,v]) => `  "${n}" → ${v.url} (${Math.round((Date.now()-v.ts)/60000)}min ago)`).join('\n');
            result = (result || '') + `\n\n[tab] ${openSessions.length - 1} other session(s) still open:\n${stale}\n  Close with: agent-browser:\\nclose  (or --session <name> close)`;
          }
          return allowWithNoop(`agent-browser output:\n\n${result || '(no output)'}`);
        } catch(e) {
          return allowWithNoop(`agent-browser error:\n\n${e.message || '(exec failed)'}`);
        }
      }

      const execMatch = command.match(/^exec(?::(\S+))?\n([\s\S]+)$/);
      if (execMatch) {
        const rawLang = (execMatch[1] || '').toLowerCase();
        const code = execMatch[2];
        if (/^\s*agent-browser\s/.test(code)) {
          return deny(`Do not call agent-browser via exec:bash. Use agent-browser: for CLI commands:\n\nagent-browser:\nopen http://example.com\n\nMultiple commands:\n\nagent-browser:\nopen http://localhost:3001\nwait 2000\nsnapshot -i\n\nFor headed mode:\n\nagent-browser:\n--headed open http://localhost:3001\nwait --load networkidle\nsnapshot -i\n\nFor JS eval in browser:\n\nexec:agent-browser\ndocument.title`);
        }
        const cwd = tool_input?.cwd;

        // ─── Lang plugin dispatch ─────────────────────────────────────────────
        if (rawLang) {
          const builtins = new Set(['js','javascript','ts','typescript','node','nodejs','py','python','sh','bash','shell','zsh','powershell','ps1','go','rust','c','cpp','java','deno','cmd','browser','ab','agent-browser','codesearch','search','status','sleep','close','runner','type']);
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
              const r = spawnSync('bun', ['-e', runnerCode], { encoding: 'utf-8', timeout: 60000, windowsHide: true });
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
        const aliases = { js: 'nodejs', javascript: 'nodejs', ts: 'typescript', node: 'nodejs', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', powershell: 'powershell', ps1: 'powershell', browser: 'agent-browser', ab: 'agent-browser', codesearch: 'codesearch', search: 'search', status: 'status', sleep: 'sleep', close: 'close', runner: 'runner', type: 'type' };
        const lang = aliases[rawLang] || rawLang || detectLang(code);
        const langExts = { nodejs: 'mjs', typescript: 'ts', deno: 'ts', python: 'py', bash: 'sh', powershell: 'ps1', go: 'go', rust: 'rs', c: 'c', cpp: 'cpp', java: 'java' };

        const spawnDirect = (bin, args, stdin) => {
          const isAb = lang === 'agent-browser';
          const spawnCwd = cwd || (isAb ? process.cwd() : undefined);
          const opts = { encoding: 'utf-8', timeout: 60000, windowsHide: true, ...(isAb && IS_WIN && { shell: true }), ...(spawnCwd && { cwd: spawnCwd }), ...(stdin !== undefined && { input: stdin }) };
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
            runGmExec(['sleep', bg[1], '15'], { timeout: 25000 });
            const sr = runGmExec(['status', bg[1]], { timeout: 15000 });
            const statusOut = stripFooter((sr.stdout || '') + (sr.stderr || ''));
            const stillRunning = /Status:\s*running/i.test(statusOut);
            out = statusOut;
            if (!stillRunning) runGmExec(['close', bg[1]], { timeout: 10000 });
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
          const r = runGmExec(['search', ...(cwd ? ['--path', cwd] : []), query], { timeout: 30000, ...(cwd && { cwd }) });
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
            // exec:agent-browser = JS eval in browser page context only.
            // Browser CLI commands (open, click, snapshot, headed mode, etc.) use agent-browser: prefix.
            const abNative = (() => {
              const abDir = path.join(TOOLS_DIR, 'node_modules', 'agent-browser', 'bin');
              const ext = IS_WIN ? '.exe' : '';
              const archMap = { x64: 'x64', arm64: 'arm64', ia32: 'x64' };
              const osMap = { win32: 'win32', darwin: 'darwin', linux: 'linux' };
              const candidate = path.join(abDir, `agent-browser-${osMap[process.platform] || process.platform}-${archMap[process.arch] || process.arch}${ext}`);
              return fs.existsSync(candidate) ? candidate : null;
            })();
            const abBin = abNative || (fs.existsSync(localBin('agent-browser')) ? localBin('agent-browser') : 'agent-browser');
            result = spawnDirect(abBin, ['eval', '--stdin'], safeCode);
          } else {
            result = runWithFile(lang, safeCode);
          }
          return allowWithNoop(`exec:${lang} output:\n\n${result || '(no output)'}`);
        } catch (e) {
          return allowWithNoop(`exec:${lang} error:\n\n${(e.stdout || '') + (e.stderr || '') || e.message || '(exec failed)'}`);
        }
      }

      if (/^bun\s+x\s+(gm-exec|rs-exec|plugkit|codebasesearch)/.test(command)) {
        return deny(`Do not call ${command.match(/^bun\s+x\s+(\S+)/)[1]} directly. Use exec:<lang> syntax instead.\n\nExamples:\n  exec:nodejs\n  console.log("hello")\n\n  exec:codesearch\n  find all database queries\n\n  exec:bash\n  ls -la\n\nThe exec: prefix routes through the hook dispatcher which handles language detection, background tasks, and tool management automatically.`);
      }

      if (!/^exec(\s|:)/.test(command) && !/^agent-browser:/.test(command) && !/^git /.test(command) && !/(\bclaude\b)/.test(command) && !/^npm install .* \/config\/.gmweb/.test(command) && !/^bun install --cwd \/config\/.gmweb/.test(command)) {
        return deny(`Bash is restricted to exec:<lang>, agent-browser:, and git.\n\nexec:<lang> syntax (lang auto-detected if omitted):\n  exec:nodejs / exec:python / exec:bash / exec:typescript\n  exec:go / exec:rust / exec:java / exec:c / exec:cpp\n  exec:cmd            ← runs cmd.exe /c on Windows\n  exec:agent-browser  ← JS eval in browser page context (document.title, DOM queries, etc.)\n  exec               ← auto-detects language\n\nexec:agent-browser — JS eval in browser page context:\n  exec:agent-browser\n  document.title\n\n  exec:agent-browser\n  JSON.stringify([...document.querySelectorAll('h1')].map(h => h.textContent))\n\nagent-browser: — browser CLI commands (open, click, snapshot, headed mode, etc.):\n  agent-browser:\n  open http://localhost:3001\n\n  agent-browser:\n  --headed open http://localhost:3001\n  wait --load networkidle\n  snapshot -i\n\n  agent-browser:\n  close\n\nTask management shortcuts (body = args):\n  exec:status\n  <task_id>\n\n  exec:sleep\n  <task_id> [seconds] [--next-output]\n\n  exec:type\n  <task_id>\n  <input to send to stdin>\n\n  exec:close\n  <task_id>\n\n  exec:runner\n  start|stop|status\n\nCode search shortcut:\n  exec:codesearch\n  <natural language query>\n\nAll other Bash commands are blocked.`);
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
