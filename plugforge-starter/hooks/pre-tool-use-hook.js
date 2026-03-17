#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');
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
        const langAliases = { js: 'nodejs', javascript: 'nodejs', ts: 'typescript', node: 'nodejs', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash' };
        const lang = langAliases[rawLang] || rawLang || detectLang(code);
        const stripFooter = (s) => s.replace(/\n\[Running tools\][\s\S]*$/, '').trimEnd();
        const runExec = (args) => {
          const r = spawnSync('bun', args, { encoding: 'utf-8', timeout: 65000 });
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
          let args;
          if (lang === 'bash' || lang === 'cmd') {
            args = ['x', 'gm-exec', 'bash'];
            if (cwd) args.push(`--cwd=${cwd}`);
            args.push(code);
          } else {
            args = ['x', 'gm-exec', 'exec', `--lang=${lang}`];
            if (cwd) args.push(`--cwd=${cwd}`);
            args.push(code);
          }
          return { block: true, reason: runExec(args) || '(no output)' };
        } catch (e) {
          return { block: true, reason: (e.stdout || '') + (e.stderr || '') || e.message || '(exec failed)' };
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
        const stripFooter = (s) => s.replace(/\n\[Running tools\][\s\S]*$/, '').trimEnd();
        try {
          const r = spawnSync('bun', ['x', 'gm-exec', 'exec', '--lang=nodejs', script], { encoding: 'utf-8', timeout: 65000 });
          const out = stripFooter((r.stdout || '') + (r.stderr || ''));
          return { block: true, reason: out || '(no output)' };
        } catch (e) {
          return { block: true, reason: (e.stdout || '') + (e.stderr || '') || e.message || '(exec failed)' };
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
