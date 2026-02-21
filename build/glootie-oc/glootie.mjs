import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyze } from 'mcp-thorns';

const SHELL_TOOLS = ['bash'];
const SEARCH_TOOLS = ['glob', 'grep', 'list'];

let thornsOutput = '';

export const GlootiePlugin = async ({ project, client, $, directory, worktree }) => {
  const pluginDir = path.dirname(fileURLToPath(import.meta.url));
  let agentRules = '';

  const loadAgentRules = () => {
    if (agentRules) return agentRules;
    const agentMd = path.join(pluginDir, 'agents', 'gm.md');
    try { agentRules = fs.readFileSync(agentMd, 'utf-8'); } catch (e) {}
    return agentRules;
  };

  const runThornsAnalysis = async () => {
    try {
      thornsOutput = '=== mcp-thorns ===\n' + analyze(directory);
    } catch (e) {
      thornsOutput = '=== mcp-thorns ===\nSkipped (' + e.message + ')';
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
  };

  return {
    event: async ({ event }) => {
      if (event.type === 'session.created') await runThornsAnalysis();
      else if (event.type === 'session.idle') await runSessionIdle();
    },

    'tool.execute.before': async (input, output) => {
      const tool = input.tool;
      if (SHELL_TOOLS.includes(tool)) {
        throw new Error('Use dev MCP tool for command execution');
      }
      if (SEARCH_TOOLS.includes(tool)) {
        throw new Error('Use code-search MCP tool or dev MCP tool for code exploration');
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
      if (thornsOutput) output.system.push(thornsOutput);
    },

    'experimental.session.compacting': async (input, output) => {
      const rules = loadAgentRules();
      if (rules) output.context.push(rules);
      const prdFile = path.join(directory, '.prd');
      if (fs.existsSync(prdFile)) {
        const prd = fs.readFileSync(prdFile, 'utf-8').trim();
        if (prd.length > 0) output.context.push('PENDING WORK (.prd):\n' + prd);
      }
    }
  };
};
