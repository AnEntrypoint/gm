#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;

const writeTools = ['Write', 'write_file'];
const searchTools = ['glob', 'search_file_content', 'Search', 'search'];
const forbiddenTools = ['find', 'Find', 'Glob', 'Grep'];

const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;

    if (!tool_name) return { allow: true };

    if (forbiddenTools.includes(tool_name)) {
      return { block: true, reason: 'Use the code-search skill for codebase exploration instead of Grep/Glob/find. Describe what you need in plain language — it understands intent, not just patterns.' };
    }

    if (writeTools.includes(tool_name)) {
      const file_path = tool_input?.file_path || '';
      const ext = path.extname(file_path);
      const inSkillsDir = file_path.includes('/skills/') || file_path.includes('\\skills\\');
      const base = path.basename(file_path).toLowerCase();
      if ((ext === '.md' || ext === '.txt' || base.startsWith('features_list')) &&
          !base.startsWith('claude') && !base.startsWith('readme') && !inSkillsDir) {
        return { block: true, reason: 'Cannot create documentation files. Only CLAUDE.md and readme.md are maintained. For task-specific notes, use .prd. For permanent reference material, add to CLAUDE.md.' };
      }
      if (/\.(test|spec)\.(js|ts|jsx|tsx|mjs|cjs)$/.test(base) ||
          /^(jest|vitest|mocha|ava|jasmine|tap)\.(config|setup)/.test(base) ||
          file_path.includes('/__tests__/') || file_path.includes('/test/') ||
          file_path.includes('/tests/') || file_path.includes('/fixtures/') ||
          file_path.includes('/test-data/') || file_path.includes('/__mocks__/') ||
          /\.(snap|stub|mock|fixture)\.(js|ts|json)$/.test(base)) {
        return { block: true, reason: 'Test files forbidden on disk. Use Bash tool with real services for all testing.' };
      }
    }

    if (searchTools.includes(tool_name)) {
      return { allow: true };
    }

    if (tool_name === 'Task') {
      const subagentType = tool_input?.subagent_type || '';
      if (subagentType === 'Explore') {
        return { block: true, reason: 'Use gm:thorns-overview for codebase insight, then use gm:code-search' };
      }
    }

    if (tool_name === 'EnterPlanMode') {
      return { block: true, reason: 'Plan mode is disabled. Use GM agent planning (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE state machine) via gm:gm subagent instead.' };
    }

    if (tool_name === 'Skill') {
      const skill = (tool_input?.skill || '').toLowerCase().replace(/^gm:/, '');
      if (skill === 'explore' || skill === 'search') {
        return { block: true, reason: 'Use the code-search skill for codebase exploration. Describe what you need in plain language — it understands intent, not just patterns.' };
      }
    }

    if (tool_name === 'Bash') {
      const command = (tool_input?.command || '').trim();

      const execMatch = command.match(/^exec(?::(\S+))?\n([\s\S]+)$/);
      if (execMatch) {
        const rawLang = (execMatch[1] || '').toLowerCase();
        const code = execMatch[2];
        const cwd = tool_input?.cwd;
        const detectLang = (src) => {
          if (/^\s*(import |from |export |const |let |var |function |class |async |await |console\.|process\.)/.test(src)) return 'nodejs';
          if (/^\s*(import |def |print\(|class |if __name__)/.test(src)) return 'python';
          if (/^\s*(echo |ls |cd |mkdir |rm |cat |grep |find |export |source |#!)/.test(src)) return 'bash';
          return 'nodejs';
        };
        const langAliases = { js: 'nodejs', javascript: 'nodejs', ts: 'typescript', node: 'nodejs', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', powershell: 'bash', ps1: 'bash', cmd: 'bash', browser: 'agent-browser', ab: 'agent-browser' };
        const lang = langAliases[rawLang] || rawLang || detectLang(code);
        const stripFooter = (s) => s.replace(/\n\[Running tools\][\s\S]*$/, '').trimEnd();
        const IS_WIN = process.platform === 'win32';
        const gmExecLangs = new Set(['go', 'rust', 'c', 'cpp', 'java']);
        const langExts = { nodejs: 'mjs', typescript: 'ts', deno: 'ts', python: 'py', bash: IS_WIN ? 'ps1' : 'sh', go: 'go', rust: 'rs', c: 'c', cpp: 'cpp', java: 'java' };
        const spawnDirect = (bin, args, input) => {
          const opts = { encoding: 'utf-8', timeout: 60000 };
          if (cwd) opts.cwd = cwd;
          if (input !== undefined) opts.input = input;
          const r = spawnSync(bin, args, opts);
          if (!r.stdout && !r.stderr && r.error) return `[spawn error: ${r.error.message}]`;
          const stdout = (r.stdout || '').trimEnd();
          const stderr = stripFooter(r.stderr || '').trimEnd();
          if (stdout && stderr) return stdout + '\n[stderr]\n' + stderr;
          return stripFooter(stdout || stderr);
        };
        const runWithFile = (lang, code) => {
          const ext = langExts[lang] || lang;
          const tmpFile = path.join(os.tmpdir(), `gm-exec-${Date.now()}.${ext}`);
          fs.writeFileSync(tmpFile, code, 'utf-8');
          const r = spawnSync('bun', ['x', 'gm-exec', 'exec', `--lang=${lang}`, `--file=${tmpFile}`, ...(cwd ? [`--cwd=${cwd}`] : [])], { encoding: 'utf-8', timeout: 65000 });
          try { fs.unlinkSync(tmpFile); } catch (e) {}
          let out = stripFooter((r.stdout || '') + (r.stderr || ''));
          const bgMatch = out.match(/Command running in background with ID:\s*(\S+)/);
          if (bgMatch) {
            const taskId = bgMatch[1];
            spawnSync('bun', ['x', 'gm-exec', 'sleep', taskId, '60'], { encoding: 'utf-8', timeout: 70000 });
            const sr = spawnSync('bun', ['x', 'gm-exec', 'status', taskId], { encoding: 'utf-8', timeout: 15000 });
            out = stripFooter((sr.stdout || '') + (sr.stderr || ''));
            spawnSync('bun', ['x', 'gm-exec', 'close', taskId], { encoding: 'utf-8', timeout: 10000 });
          }
          return out;
        };
        try {
          let result;
          if (lang === 'bash') {
            const ext = IS_WIN ? 'ps1' : 'sh';
            const shFile = path.join(os.tmpdir(), `gm-exec-${Date.now()}.${ext}`);
            fs.writeFileSync(shFile, code, 'utf-8');
            if (IS_WIN) {
              result = spawnDirect('powershell', ['-NoProfile', '-NonInteractive', '-File', shFile]);
              try { fs.unlinkSync(shFile); } catch (e) {}
              if (!result || result.startsWith('[spawn error:')) result = runWithFile('bash', code);
            } else {
              result = spawnDirect('bash', [shFile]);
              try { fs.unlinkSync(shFile); } catch (e) {}
              if (!result || result.startsWith('[spawn error:')) result = runWithFile('bash', code);
            }
          } else if (lang === 'python') {
            result = spawnDirect('python3', ['-c', code]);
            if (!result || result.startsWith('[spawn error:')) result = spawnDirect('python', ['-c', code]);
          } else if (!lang || lang === 'nodejs' || lang === 'typescript' || lang === 'deno') {
            const ext = lang === 'typescript' || lang === 'deno' ? 'ts' : 'mjs';
            const tmpFile = path.join(os.tmpdir(), `gm-exec-${Date.now()}.${ext}`);
            const wrapped = `const __result = await (async () => {\n${code}\n})();\nif (__result !== undefined) { if (typeof __result === 'object') { console.log(JSON.stringify(__result, null, 2)); } else { console.log(__result); } }`;
            fs.writeFileSync(tmpFile, wrapped, 'utf-8');
            result = spawnDirect('bun', ['run', tmpFile]);
            try { fs.unlinkSync(tmpFile); } catch (e) {}
            if (result) result = result.split(tmpFile).join('<script>');
          } else if (lang === 'agent-browser') {
            result = spawnDirect('agent-browser', ['eval', '--stdin'], code);
          } else if (gmExecLangs.has(lang)) {
            result = runWithFile(lang, code);
          } else {
            result = runWithFile(lang, code);
          }
          return { block: true, reason: `exec ran successfully. Output:\n\n${result || '(no output)'}` };
        } catch (e) {
          return { block: true, reason: `exec ran. Error:\n\n${(e.stdout || '') + (e.stderr || '') || e.message || '(exec failed)'}` };
        }
      }

      if (!/^exec(\s|:)/.test(command) && !/^bun x gm-exec(@[^\s]*)?(\s|$)/.test(command) && !/^git /.test(command) && !/^bun x codebasesearch/.test(command) && !/(\bclaude\b)/.test(command) && !/^npm install .* \/config\/.gmweb\/npm-global\/lib\/node_modules\/gm-exec/.test(command) && !/^bun install --cwd \/config\/.gmweb\/npm-global\/lib\/node_modules\/gm-exec/.test(command)) {
        let helpText = '';
        try { helpText = '\n\n' + execSync('bun x gm-exec --help', { timeout: 10000 }).toString().trim(); } catch (e) {}
        return { block: true, reason: `Bash is restricted to exec:<lang> interception and git.\n\nUse exec:<lang> syntax:\n  exec:nodejs\\n<js code>\n  exec:python\\n<python code>\n  exec:bash\\n<shell commands>\n  exec:typescript\\n<ts code>\n  exec (no lang — auto-detects)\n\nOr use bun x gm-exec directly:\n  bun x gm-exec${helpText}\n\nDocs: https://www.npmjs.com/package/gm-exec\n\nAll other Bash commands are blocked.` };
      }
    }

    if (tool_name === 'agent-browser') {
      const input = tool_input || {};
      const script = input.script || input.code || '';
      if (script && !input.url && !input.navigate) {
        const sFooter = (s) => s.replace(/\n\[Running tools\][\s\S]*$/, '').trimEnd();
        try {
          const tmpFile = path.join(os.tmpdir(), `gm-exec-${Date.now()}.mjs`);
          fs.writeFileSync(tmpFile, script, 'utf-8');
          const r = spawnSync('bun', ['run', tmpFile], { encoding: 'utf-8', timeout: 65000 });
          try { fs.unlinkSync(tmpFile); } catch (e) {}
          const stdout = (r.stdout || '').trimEnd();
          const stderr = sFooter(r.stderr || '').trimEnd();
          const out = stdout && stderr ? stdout + '\n[stderr]\n' + stderr : sFooter(stdout || stderr);
          return { block: true, reason: `exec ran successfully. Output:\n\n${out || '(no output)'}` };
        } catch (e) {
          return { block: true, reason: `exec ran. Error:\n\n${(e.stdout || '') + (e.stderr || '') || e.message || '(exec failed)'}` };
        }
      }
    }

    // Allow essential tools explicitly
    const allowedTools = ['agent-browser', 'Skill', 'code-search', 'electron', 'TaskOutput', 'ReadMcpResourceTool', 'ListMcpResourcesTool'];
    if (allowedTools.includes(tool_name)) {
      return { allow: true };
    }

    return { allow: true };
  } catch (error) {
    return { allow: true };
  }
};

try {
  const result = run();

  if (result.block) {
    if (isGemini) {
      console.log(JSON.stringify({ decision: 'deny', reason: result.reason }));
    } else {
      console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
    }
    process.exit(0);
  }

  if (isGemini) {
    console.log(JSON.stringify({ decision: 'allow' }));
  }

  process.exit(0);
} catch (error) {
  process.exit(0);
}
