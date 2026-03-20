#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;

const writeTools = ['Write', 'write_file'];
const searchTools = ['glob', 'search_file_content', 'Search', 'search'];
const forbiddenTools = ['find', 'Find', 'Glob', 'Grep'];

const allow = (additionalContext) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', ...(additionalContext && { additionalContext }) }
});
const deny = (reason) => isGemini
  ? { decision: 'deny', reason }
  : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
const allowWithNoop = (context) => {
  const b64 = Buffer.from(context, 'utf-8').toString('base64');
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { command: `bun -e "process.stdout.write(Buffer.from('${b64}','base64').toString())"` }
    }
  };
};

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
      const execMatch = command.match(/^exec(?::(\S+))?\n([\s\S]+)$/);
      if (execMatch) {
        const rawLang = (execMatch[1] || '').toLowerCase();
        const code = execMatch[2];
        if (/^\s*agent-browser\s/.test(code)) {
          return deny(`Do not call agent-browser via exec:bash. Use exec:agent-browser instead:\n\nexec:agent-browser\n<plain JS here>\n\nThe code is piped directly to the browser eval. No base64, no flags, no shell wrapping.`);
        }
        const cwd = tool_input?.cwd;
        const detectLang = (src) => {
          if (/^\s*(import |from |export |const |let |var |function |class |async |await |console\.|process\.)/.test(src)) return 'nodejs';
          if (/^\s*(import |def |print\(|class |if __name__)/.test(src)) return 'python';
          if (/^\s*(echo |ls |cd |mkdir |rm |cat |grep |find |export |source |#!)/.test(src)) return 'bash';
          return 'nodejs';
        };
        const aliases = { js: 'nodejs', javascript: 'nodejs', ts: 'typescript', node: 'nodejs', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', powershell: 'bash', ps1: 'bash', cmd: 'bash', browser: 'agent-browser', ab: 'agent-browser', codesearch: 'codesearch', search: 'search', status: 'status', sleep: 'sleep', close: 'close', runner: 'runner' };
        const lang = aliases[rawLang] || rawLang || detectLang(code);
        const IS_WIN = process.platform === 'win32';
        const stripFooter = (s) => s.replace(/\n\[Running tools\][\s\S]*$/, '').trimEnd();
        const langExts = { nodejs: 'mjs', typescript: 'ts', deno: 'ts', python: 'py', bash: IS_WIN ? 'ps1' : 'sh', go: 'go', rust: 'rs', c: 'c', cpp: 'cpp', java: 'java' };
        const spawnDirect = (bin, args, stdin) => {
          const opts = { encoding: 'utf-8', timeout: 60000, ...(cwd && { cwd }), ...(stdin !== undefined && { input: stdin }) };
          const r = spawnSync(bin, args, opts);
          if (!r.stdout && !r.stderr && r.error) return `[spawn error: ${r.error.message}]`;
          const out = (r.stdout || '').trimEnd(), err = stripFooter(r.stderr || '').trimEnd();
          return out && err ? out + '\n[stderr]\n' + err : stripFooter(out || err);
        };
        const runWithFile = (l, src) => {
          const tmp = path.join(os.tmpdir(), `gm-exec-${Date.now()}.${langExts[l] || l}`);
          fs.writeFileSync(tmp, src, 'utf-8');
          const r = spawnSync('bun', ['x', 'gm-exec', 'exec', `--lang=${l}`, `--file=${tmp}`, ...(cwd ? [`--cwd=${cwd}`] : [])], { encoding: 'utf-8', timeout: 65000 });
          try { fs.unlinkSync(tmp); } catch (e) {}
          let out = stripFooter((r.stdout || '') + (r.stderr || ''));
          const bg = out.match(/Task ID:\s*(task_\S+)/);
          if (bg) {
            spawnSync('bun', ['x', 'gm-exec', 'sleep', bg[1], '60'], { encoding: 'utf-8', timeout: 70000 });
            const sr = spawnSync('bun', ['x', 'gm-exec', 'status', bg[1]], { encoding: 'utf-8', timeout: 15000 });
            out = stripFooter((sr.stdout || '') + (sr.stderr || ''));
            spawnSync('bun', ['x', 'gm-exec', 'close', bg[1]], { encoding: 'utf-8', timeout: 10000 });
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
          const r = spawnSync('bun', ['x', 'codebasesearch', query], { encoding: 'utf-8', timeout: 30000, ...(cwd && { cwd }) });
          return allowWithNoop(`exec:${lang} output:\n\n${stripFooter((r.stdout || '') + (r.stderr || '')) || '(no results)'}`);
        }
        if (lang === 'status') {
          const taskId = safeCode.trim();
          const r = spawnSync('bun', ['x', 'gm-exec', 'status', taskId], { encoding: 'utf-8', timeout: 15000 });
          return allowWithNoop(`exec:status output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        if (lang === 'sleep') {
          const parts = safeCode.trim().split(/\s+/);
          const args = ['x', 'gm-exec', 'sleep', ...parts];
          const r = spawnSync('bun', args, { encoding: 'utf-8', timeout: 70000 });
          return allowWithNoop(`exec:sleep output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        if (lang === 'close') {
          const taskId = safeCode.trim();
          const r = spawnSync('bun', ['x', 'gm-exec', 'close', taskId], { encoding: 'utf-8', timeout: 15000 });
          return allowWithNoop(`exec:close output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        if (lang === 'runner') {
          const sub = safeCode.trim();
          const r = spawnSync('bun', ['x', 'gm-exec', 'runner', sub], { encoding: 'utf-8', timeout: 15000 });
          return allowWithNoop(`exec:runner output:\n\n${stripFooter((r.stdout || '') + (r.stderr || ''))}`);
        }
        try {
          let result;
          if (lang === 'bash') {
            const shFile = path.join(os.tmpdir(), `gm-exec-${Date.now()}.${IS_WIN ? 'ps1' : 'sh'}`);
            fs.writeFileSync(shFile, safeCode, 'utf-8');
            result = IS_WIN
              ? spawnDirect('powershell', ['-NoProfile', '-NonInteractive', '-File', shFile])
              : spawnDirect('bash', [shFile]);
            try { fs.unlinkSync(shFile); } catch (e) {}
            if (!result || result.startsWith('[spawn error:')) result = runWithFile('bash', safeCode);
          } else if (lang === 'python') {
            result = spawnDirect('python3', ['-c', safeCode]);
            if (!result || result.startsWith('[spawn error:')) result = spawnDirect('python', ['-c', safeCode]);
          } else if (!lang || ['nodejs', 'typescript', 'deno'].includes(lang)) {
            const ext = lang === 'typescript' || lang === 'deno' ? 'ts' : 'mjs';
            const tmp = path.join(os.tmpdir(), `gm-exec-${Date.now()}.${ext}`);
            const wrapped = `const __result = await (async () => {\n${safeCode}\n})();\nif (__result !== undefined) { if (typeof __result === 'object') { console.log(JSON.stringify(__result, null, 2)); } else { console.log(__result); } }`;
            fs.writeFileSync(tmp, wrapped, 'utf-8');
            result = spawnDirect('bun', ['run', tmp]);
            try { fs.unlinkSync(tmp); } catch (e) {}
            if (result) result = result.split(tmp).join('<script>');
          } else if (lang === 'agent-browser') {
            result = spawnDirect('agent-browser', ['eval', '--stdin'], safeCode);
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
        try { helpText = '\n\n' + execSync('bun x gm-exec --help', { timeout: 10000 }).toString().trim(); } catch (e) {}
        return deny(`Bash is restricted to exec:<lang> and git.\n\nexec:<lang> syntax (lang auto-detected if omitted):\n  exec:nodejs / exec:python / exec:bash / exec:typescript\n  exec:go / exec:rust / exec:java / exec:c / exec:cpp\n  exec:agent-browser  ← plain JS piped to browser eval (NO base64)\n  exec               ← auto-detects language\n\nTask management shortcuts (body = args):\n  exec:status\n  <task_id>\n\n  exec:sleep\n  <task_id> [seconds] [--next-output]\n\n  exec:close\n  <task_id>\n\n  exec:runner\n  start|stop|status\n\nCode search shortcut:\n  exec:codesearch\n  <natural language query>\n\nNEVER encode agent-browser code as base64 — pass plain JS directly.\n\nbun x gm-exec${helpText}\n\nAll other Bash commands are blocked.`);
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
