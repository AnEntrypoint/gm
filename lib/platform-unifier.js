const { checkPlatformCompatibility } = require('./plugin-spec');

const platformEventMap = {
  cc: {
    'session-start': 'SessionStart',
    'pre-tool': 'PreToolUse',
    'prompt-submit': 'UserPromptSubmit',
    'stop': 'Stop',
    'stop-git': 'StopGit'
  },
  gc: {
    'session-start': 'SessionStart',
    'pre-tool': 'BeforeTool',
    'prompt-submit': 'BeforeAgent',
    'stop': 'SessionEnd',
    'stop-git': 'SessionEnd'
  },
  oc: {
    'session-start': 'session.created',
    'pre-tool': 'tool.execute.before',
    'prompt-submit': 'message.updated',
    'stop': 'session.closing',
    'stop-git': 'session.closing'
  }
};

const platformToolMap = {
  cc: {
    bash: 'Bash',
    write: 'Write',
    glob: 'Glob',
    grep: 'Grep',
    search: 'Search'
  },
  gc: {
    bash: 'run_shell_command',
    write: 'write_file',
    glob: 'glob',
    grep: 'search_file_content',
    search: 'search'
  },
  oc: {
    bash: 'spawn/exec',
    write: 'fs.writeFile',
    glob: 'fs.glob',
    grep: 'grep',
    search: 'search'
  }
};

const adaptSpecForPlatform = (spec, platformId) => {
  const warnings = checkPlatformCompatibility(spec, platformId);

  return {
    ...spec,
    platform: platformId,
    eventMap: platformEventMap[platformId],
    toolMap: platformToolMap[platformId],
    hookOutputFormat: platformId === 'cc' ? 'wrapped' : platformId === 'gc' ? 'bare' : 'sdk',
    warnings: warnings.warnings
  };
};

const getPlatformHookName = (genericHookId, platformId) => {
  return platformEventMap[platformId]?.[genericHookId] || genericHookId;
};

const getPlatformToolName = (genericToolId, platformId) => {
  return platformToolMap[platformId]?.[genericToolId] || genericToolId;
};

module.exports = {
  adaptSpecForPlatform,
  getPlatformHookName,
  getPlatformToolName,
  platformEventMap,
  platformToolMap
};
