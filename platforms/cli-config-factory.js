const factory = (name, label, configFile, contextFile, overrides = {}) => {
  const hookEvents = {
<<<<<<< HEAD
    cc: { sessionStart: 'SessionStart', preTool: 'PreToolUse', promptSubmit: 'UserPromptSubmit', stop: 'Stop' },
    gc: { sessionStart: 'SessionStart', preTool: 'BeforeTool', promptSubmit: 'BeforeAgent', stop: 'SessionEnd' },
    codex: { sessionStart: 'SessionStart', preTool: 'PreToolUse', promptSubmit: 'UserPromptSubmit', stop: 'Stop' },
    oc: { sessionStart: 'session.created', preTool: 'tool.execute.before', promptSubmit: 'message.updated', stop: 'session.closing' },
    kilo: { sessionStart: 'session.created', preTool: 'tool.execute.before', promptSubmit: 'message.updated', stop: 'session.closing' }
  };

  const hookFormats = { cc: 'wrapped', gc: 'bare', codex: 'wrapped', oc: 'sdk', kilo: 'sdk' };
=======
    cc: { preTool: 'PreToolUse', postTool: 'PostToolUse', promptSubmit: 'UserPromptSubmit', stop: 'Stop' },
    gc: { preTool: 'BeforeTool', postTool: 'AfterTool', promptSubmit: 'BeforeAgent', stop: 'SessionEnd' },
    codex: { preTool: 'PreToolUse', postTool: 'PostToolUse', promptSubmit: 'UserPromptSubmit', stop: 'Stop' },
    oc: { preTool: 'tool.execute.before', postTool: 'tool.execute.after', promptSubmit: 'message.updated', stop: 'session.closing' },
    kilo: { preTool: 'tool.execute.before', postTool: 'tool.execute.after', promptSubmit: 'message.updated', stop: 'session.closing' }
  };

  const hookFormats = { cc: 'wrapped', gc: 'wrapped', codex: 'wrapped', oc: 'sdk', kilo: 'sdk' };
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
  const toolNames = {
    cc: { bash: 'Bash', write: 'Write', glob: 'Glob', grep: 'Grep', search: 'Search' },
    gc: { bash: 'run_shell_command', write: 'write_file', glob: 'glob', grep: 'search_file_content', search: 'search' },
    codex: { bash: 'Bash', write: 'Write', glob: 'Glob', grep: 'Grep', search: 'Search' },
    oc: { bash: 'spawn/exec', write: 'fs.writeFile', glob: 'fs.glob', grep: 'grep', search: 'search' },
    kilo: { bash: 'spawn/exec', write: 'fs.writeFile', glob: 'fs.glob', grep: 'grep', search: 'search' }
  };

  const envVars = {
    cc: { pluginRoot: 'CLAUDE_PLUGIN_ROOT', projectDir: 'CLAUDE_PROJECT_DIR' },
    gc: { pluginRoot: 'GEMINI_PROJECT_DIR', projectDir: 'GEMINI_PROJECT_DIR' },
    codex: { pluginRoot: 'CODEX_PLUGIN_ROOT', projectDir: 'CODEX_PROJECT_DIR' },
    oc: { pluginRoot: 'OC_PLUGIN_ROOT', projectDir: 'OC_PROJECT_DIR' },
    kilo: { pluginRoot: 'KILO_PLUGIN_ROOT', projectDir: 'KILO_PROJECT_DIR' }
  };

  return {
    name,
    label,
    configFile,
    contextFile,
    hookEventNames: hookEvents[name],
    hookOutputFormat: hookFormats[name],
    tools: toolNames[name],
    env: envVars[name],
    ...overrides
  };
};

module.exports = factory;
