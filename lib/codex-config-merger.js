const fs = require('fs');
const path = require('path');

const SENTINEL_START = '# >>> gm-codex managed (do not edit between sentinels)';
const SENTINEL_END = '# <<< gm-codex managed';

function tomlString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function expandPluginRoot(cmd, pluginRoot) {
  return String(cmd).split('${CODEX_PLUGIN_ROOT}').join(pluginRoot);
}

function buildHooksToml(hooksJson, pluginRoot) {
  const hooks = (hooksJson && hooksJson.hooks) || {};
  const lines = [];
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event] || [];
    for (const group of groups) {
      const matcher = group.matcher || '*';
      const entries = group.hooks || [];
      if (!entries.length) continue;
      lines.push('');
      lines.push(`[[hooks.${event}]]`);
      lines.push(`matcher = ${tomlString(matcher)}`);
      for (const e of entries) {
        lines.push('');
        lines.push(`[[hooks.${event}.hooks]]`);
        lines.push(`type = ${tomlString(e.type || 'command')}`);
        lines.push(`command = ${tomlString(expandPluginRoot(e.command, pluginRoot))}`);
        const timeoutSecs = typeof e.timeout === 'number' ? Math.max(1, Math.round(e.timeout / 1000)) : 60;
        lines.push(`timeout = ${timeoutSecs}`);
      }
    }
  }
  return lines.join('\n');
}

function buildMcpToml(mcpJson) {
  const servers = (mcpJson && mcpJson.mcpServers) || {};
  const lines = [];
  for (const id of Object.keys(servers)) {
    const s = servers[id];
    lines.push('');
    lines.push(`[mcp_servers.${id}]`);
    if (s.command) lines.push(`command = ${tomlString(s.command)}`);
    if (Array.isArray(s.args)) lines.push(`args = [${s.args.map(tomlString).join(', ')}]`);
    if (s.cwd) lines.push(`cwd = ${tomlString(s.cwd)}`);
    if (s.url) lines.push(`url = ${tomlString(s.url)}`);
    if (s.env && typeof s.env === 'object') {
      lines.push('');
      lines.push(`[mcp_servers.${id}.env]`);
      for (const k of Object.keys(s.env)) lines.push(`${k} = ${tomlString(s.env[k])}`);
    }
  }
  return lines.join('\n');
}

function buildSkillsToml(skillsDir) {
  if (!fs.existsSync(skillsDir)) return '';
  const lines = [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(skillsDir, ent.name);
    if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) continue;
    lines.push('');
    lines.push('[[skills.config]]');
    lines.push(`path = ${tomlString(skillPath)}`);
    lines.push('enabled = true');
  }
  return lines.join('\n');
}

function buildManagedBlock(pluginRoot) {
  const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');
  const mcpJsonPath = path.join(pluginRoot, '.mcp.json');
  const skillsDir = path.join(pluginRoot, 'skills');
  const hooksJson = fs.existsSync(hooksJsonPath) ? JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8')) : { hooks: {} };
  const mcpJson = fs.existsSync(mcpJsonPath) ? JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8')) : { mcpServers: {} };
  const parts = [
    SENTINEL_START,
    '',
    '[features]',
    'codex_hooks = true',
    buildHooksToml(hooksJson, pluginRoot),
    buildMcpToml(mcpJson),
    buildSkillsToml(skillsDir),
    '',
    SENTINEL_END
  ];
  return parts.filter(p => p !== '').join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

function stripManagedBlock(content) {
  if (!content) return '';
  const startIdx = content.indexOf(SENTINEL_START);
  if (startIdx === -1) return content;
  const endIdx = content.indexOf(SENTINEL_END, startIdx);
  if (endIdx === -1) return content;
  const tail = content.slice(endIdx + SENTINEL_END.length);
  const head = content.slice(0, startIdx);
  return (head.replace(/\n*$/, '\n') + tail.replace(/^\n+/, '')).replace(/\n{3,}/g, '\n\n');
}

function mergeIntoConfigToml(configPath, pluginRoot) {
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const stripped = stripManagedBlock(existing).replace(/\s+$/, '');
  const block = buildManagedBlock(pluginRoot);
  const next = stripped ? stripped + '\n\n' + block : block;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, next);
  return { wrote: true, path: configPath };
}

function uninstallFromConfigToml(configPath) {
  if (!fs.existsSync(configPath)) return { wrote: false };
  const existing = fs.readFileSync(configPath, 'utf8');
  const stripped = stripManagedBlock(existing);
  if (stripped === existing) return { wrote: false };
  if (stripped.trim() === '') {
    fs.unlinkSync(configPath);
    return { wrote: true, deleted: true };
  }
  fs.writeFileSync(configPath, stripped);
  return { wrote: true };
}

module.exports = {
  SENTINEL_START,
  SENTINEL_END,
  buildManagedBlock,
  stripManagedBlock,
  mergeIntoConfigToml,
  uninstallFromConfigToml
};
