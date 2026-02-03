import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyze } from 'mcp-thorns';

export const GlootiePlugin = async ({ project, client, $, directory, worktree }) => {
  const pluginDir = path.dirname(fileURLToPath(import.meta.url));

  const runSessionStart = async () => {
    if (!client || !client.tui) return;
    await new Promise(resolve => setTimeout(resolve, 500));
    const outputs = [];
    const agentMd = path.join(pluginDir, 'agents', 'gm.md');
    if (fs.existsSync(agentMd)) {
      try { outputs.push(fs.readFileSync(agentMd, 'utf-8')); } catch (e) {}
    }
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
      const ahead = await $`git rev-list --count origin/HEAD..HEAD`.timeout(2000).nothrow();
      if (ahead.exitCode === 0 && parseInt(ahead.stdout.trim()) > 0)
        blockReasons.push('Git: ' + ahead.stdout.trim() + ' commit(s) ahead of origin/HEAD');
    } catch (e) {}
    try {
      const behind = await $`git rev-list --count HEAD..origin/HEAD`.timeout(2000).nothrow();
      if (behind.exitCode === 0 && parseInt(behind.stdout.trim()) > 0)
        blockReasons.push('Git: ' + behind.stdout.trim() + ' commit(s) behind origin/HEAD');
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
    }
  };
};
