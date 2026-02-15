import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyze } from 'mcp-thorns';

const SHELL_TOOLS = ['bash'];
const SEARCH_TOOLS = ['glob', 'grep', 'list'];

export const GlootiePlugin = async ({ project, client, $, directory, worktree }) => {
  const pluginDir = path.dirname(fileURLToPath(import.meta.url));
  let agentRules = '';

  const loadAgentRules = () => {
    if (agentRules) return agentRules;
    const agentMd = path.join(pluginDir, 'agents', 'gm.md');
    try { agentRules = fs.readFileSync(agentMd, 'utf-8'); } catch (e) {}
    return agentRules;
  };

  const runSessionStart = async () => {
    if (!client || !client.tui) return;
    await new Promise(resolve => setTimeout(resolve, 500));
    const outputs = [];
    const rules = loadAgentRules();
    if (rules) outputs.push(rules);
    try {
      outputs.push('=== mcp-thorns ===\n' + analyze(directory));
    } catch (e) {
      outputs.push('=== mcp-thorns ===\nSkipped (' + e.message + ')');
    }
    if (outputs.length === 0) return;
    const text = outputs.join('\n\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/[\u2028\u2029]/g, '\n')
      .trim();
    try {
      await client.tui.appendPrompt({ body: { text } });
    } catch (e) {
      if (e.message && (e.message.includes('EditBuffer') || e.message.includes('disposed') || e.message.includes('illegal character') || e.message.includes('Array index'))) return;
      throw e;
    }
  };

  const runSessionIdle = async () => {
    if (!client || !client.tui) return;
    const blockReasons = [];
    try {
      const status = await $`git status --porcelain`.timeout(2000).nothrow();
      if (status.exitCode === 0 && status.stdout.trim().length > 0)
        blockReasons.push('Git: Uncommitted changes exist');
    } catch (e) {}
    try {
      const ahead = await $`git rev-list --count @{u}..HEAD`.timeout(2000).nothrow();
      if (ahead.exitCode === 0 && parseInt(ahead.stdout.trim()) > 0)
        blockReasons.push('Git: ' + ahead.stdout.trim() + ' commit(s) not pushed');
    } catch (e) {}
    try {
      const behind = await $`git rev-list --count HEAD..@{u}`.timeout(2000).nothrow();
      if (behind.exitCode === 0 && parseInt(behind.stdout.trim()) > 0)
        blockReasons.push('Git: ' + behind.stdout.trim() + ' upstream change(s) not pulled');
    } catch (e) {}
    const prdFile = path.join(directory, '.prd');
    if (fs.existsSync(prdFile)) {
      const prd = fs.readFileSync(prdFile, 'utf-8').trim();
      if (prd.length > 0) blockReasons.push('Work items remain in .prd:\n' + prd);
    }
    if (blockReasons.length > 0) throw new Error(blockReasons.join(' | '));
    const filesToRun = [];
    const evalJs = path.join(directory, 'eval.js');
    if (fs.existsSync(evalJs)) filesToRun.push('eval.js');
    const evalsDir = path.join(directory, 'evals');
    if (fs.existsSync(evalsDir) && fs.statSync(evalsDir).isDirectory()) {
      filesToRun.push(...fs.readdirSync(evalsDir)
        .filter(f => f.endsWith('.js') && !path.join(evalsDir, f).includes('/lib/'))
        .sort().map(f => path.join('evals', f)));
    }
    for (const file of filesToRun) {
      try { await $`node ${file}`.timeout(60000); } catch (e) {
        throw new Error('eval error: ' + e.message + '\n' + (e.stdout || '') + '\n' + (e.stderr || ''));
      }
    }
  };

  return {
    event: async ({ event }) => {
      if (event.type === 'session.created') await runSessionStart();
      else if (event.type === 'session.idle') await runSessionIdle();
    },

    'tool.execute.before': async (input, output) => {
      const tool = input.tool;
      if (SHELL_TOOLS.includes(tool)) {
        throw new Error('Use plugin:gm:dev execute for all command execution');
      }
      if (SEARCH_TOOLS.includes(tool)) {
        throw new Error('Use plugin:gm:code-search or plugin:gm:dev for code exploration');
      }
      if (tool === 'write' || tool === 'edit' || tool === 'patch') {
        const fp = output.args?.file_path || output.args?.filePath || output.args?.path || '';
        const ext = path.extname(fp);
        const base = path.basename(fp).toLowerCase();
        const inSkills = fp.includes('/skills/');
        if ((ext === '.md' || ext === '.txt' || base.startsWith('features_list')) &&
            !base.startsWith('claude') && !base.startsWith('readme') && !base.startsWith('glootie') && !inSkills) {
          throw new Error('Cannot create documentation files. Only CLAUDE.md, GLOOTIE.md, and README.md are maintained.');
        }
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      const rules = loadAgentRules();
      if (rules) output.system.push(rules);
    },

    'experimental.session.compacting': async (input, output) => {
      const rules = loadAgentRules();
      if (rules) output.context.push(rules);
    }
  };
};
