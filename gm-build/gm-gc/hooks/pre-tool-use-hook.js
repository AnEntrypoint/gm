#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const writeTools = ['write_file', 'edit_file'];
const forbiddenTools = ['find', 'Find', 'Glob', 'Grep', 'glob', 'search_file_content'];
const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;
    if (!tool_name) return { allow: true };
    if (forbiddenTools.includes(tool_name)) {
      return { deny: true, reason: 'Use the code-search skill for codebase exploration instead of Grep/Glob/find. Describe what you need in plain language.' };
    }
    if (writeTools.includes(tool_name)) {
      const file_path = tool_input?.file_path || '';
      const ext = path.extname(file_path);
      const inSkillsDir = file_path.includes('/skills/');
      const base = path.basename(file_path).toLowerCase();
      if ((ext === '.md' || ext === '.txt' || base.startsWith('features_list')) &&
          !base.startsWith('claude') && !base.startsWith('agents') && !base.startsWith('readme') && !inSkillsDir) {
        return { deny: true, reason: 'Cannot create documentation files. Only AGENTS.md, CLAUDE.md and readme.md are maintained.' };
      }
      if (/\.(test|spec)\.(js|ts|jsx|tsx|mjs|cjs)$/.test(base) ||
          /^(jest|vitest|mocha|ava|jasmine|tap)\.(config|setup)/.test(base) ||
          /\.(snap|stub|mock|fixture)\.(js|ts|json)$/.test(base) ||
          file_path.includes('/__tests__/') || file_path.includes('/test/') ||
          file_path.includes('/tests/') || file_path.includes('/fixtures/') ||
          file_path.includes('/test-data/') || file_path.includes('/__mocks__/')) {
        return { deny: true, reason: 'Test files forbidden on disk. Use real services for all testing.' };
      }
    }
    if (tool_name === 'run_shell_command') {
      const command = (tool_input?.command || '').trim();
      const isExec = command.startsWith('exec:');
      const isGit = /^(git |gh )/.test(command);
      if (!isExec && !isGit) {
        return { deny: true, reason: 'run_shell_command requires exec:<lang> format with a NEWLINE between the lang and code. Example: exec:bash\nnpm --version\n(newline after exec:bash, not a space). Allowed: exec:nodejs, exec:bash, exec:python, exec:typescript, git, gh.' };
      }
      if (isExec) {
        const newline = command.indexOf('\n');
        if (newline === -1) return { allow: true };
        const rawLang = command.substring(5, newline);
        const code = command.substring(newline + 1);
        const { spawnSync } = require('child_process');
        const pluginRoot = path.join(__dirname, '..');
        const plugkitJs = path.join(pluginRoot, 'bin', 'plugkit.js');
        let result;
        if (rawLang === 'browser') {
          result = spawnSync('node', [plugkitJs, 'exec', '--lang', 'browser', code], { encoding: 'utf-8', timeout: 300000, windowsHide: true });
        } else if (rawLang === 'codesearch') {
          const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
          result = spawnSync('node', [plugkitJs, 'search', '--path', projectDir, code], { encoding: 'utf-8', timeout: 60000, windowsHide: true });
        } else {
          result = spawnSync('node', [plugkitJs, 'exec', '--lang', rawLang, code], { encoding: 'utf-8', timeout: 120000, windowsHide: true });
        }
        const output = (result.stdout || '') + (result.stderr || '');
        return { deny: true, reason: 'exec:' + rawLang + ' output:\n\n' + output };
      }
    }
    return { allow: true };
  } catch (e) {
    return { allow: true };
  }
};
try {
  const result = run();
  if (result.deny) {
    console.log(JSON.stringify({ decision: 'deny', reason: result.reason }));
    process.exit(0);
  }
  process.exit(0);
} catch (e) {
  process.exit(0);
}
