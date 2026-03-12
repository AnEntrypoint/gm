const PlatformAdapter = require('../platforms/base');
const path = require('path');
const TemplateBuilder = require('./template-builder');

class CLIAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super(config);
    this.cliConfig = {
      hookEventNames: config.hookEventNames || {},
      hookOutputFormat: config.hookOutputFormat || 'wrapped',
      tools: config.tools || {},
      env: config.env || {}
    };
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    const packageJsonSource = this.shouldAlwaysGeneratePackageJson ? null : readFile(['package.json']);
    const structure = {
      [this.configFile]: this.generateConfigJson(pluginSpec),
      '.mcp.json': this.generateMcpJson(pluginSpec),
      [this.contextFile]: readFile(['CLAUDE.md']) || this.generateContextFile(),
      'README.md': this.generateReadme(pluginSpec),
      'package.json': packageJsonSource || this.generatePackageJson(pluginSpec, this.getPackageJsonFields()),
      'hooks/hooks.json': this.generateHooksJson(pluginSpec),
<<<<<<< HEAD
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'hooks/pre-tool-use-hook.js': readFile(this.getHookSourcePaths('pre-tool-use')),
      'hooks/session-start-hook.js': readFile(this.getHookSourcePaths('session-start')),
=======
      'agents/gm.md': this.transformAgentContent ? this.transformAgentContent('gm', readFile(this.getAgentSourcePaths('gm'))) : readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'hooks/pre-tool-use-hook.js': readFile(this.getHookSourcePaths('pre-tool-use')),
      'hooks/post-tool-use-hook.js': readFile(this.getHookSourcePaths('post-tool-use')),
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
      'hooks/prompt-submit-hook.js': readFile(this.getHookSourcePaths('prompt-submit')),
      'hooks/stop-hook.js': readFile(this.getHookSourcePaths('stop')),
      'hooks/stop-hook-git.js': readFile(this.getHookSourcePaths('stop-git')),
      ...this.getAdditionalFiles(pluginSpec, readFile)
    };
    const skills = this.loadSkillsFromSource(sourceDir);
    Object.assign(structure, skills);
    const scripts = this.loadScriptsFromSource(sourceDir);
    Object.assign(structure, scripts);
    return structure;
  }

  getPackageJsonFields() {
    return {
      main: this.getPackageJsonMain(),
      files: this.getPackageJsonFiles(),
      ...(this.getPeerDependencies && { peerDependencies: this.getPeerDependencies() })
    };
  }

  getPackageJsonMain() {
    return 'cli.js';
  }

  getPackageJsonFiles() {
    return [
      'agents/',
      'hooks/',
      'skills/',
      'scripts/',
      '.github/',
      'README.md',
      this.contextFile,
      '.mcp.json',
      this.configFile,
      'cli.js'
    ];
  }

  getHookSourcePaths(hook) {
    // Canonical hook naming: {descriptive-name}-hook.js
    // Maps hook identifiers to their canonical filenames
    const hookFileMap = {
      'pre-tool-use': 'pre-tool-use-hook.js',
<<<<<<< HEAD
      'session-start': 'session-start-hook.js',
=======
      'post-tool-use': 'post-tool-use-hook.js',
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
      'prompt-submit': 'prompt-submit-hook.js',
      'stop': 'stop-hook.js',
      'stop-git': 'stop-hook-git.js'
    };
    const hookFile = hookFileMap[hook] || `${hook}-hook.js`;
    return [`hooks/${hookFile}`];
  }

  getAdditionalFiles(pluginSpec, readFile) {
    return {};
  }

  loadSkillsFromSource(sourceDir) {
    return TemplateBuilder.loadSkillsFromSource(sourceDir, 'skills');
  }

  loadScriptsFromSource(sourceDir) {
    return TemplateBuilder.loadScriptsFromSource(sourceDir, 'scripts');
  }

  generateConfigJson(pluginSpec) {
    const config = {
      name: pluginSpec.name,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      homepage: pluginSpec.homepage
    };
    return this.formatConfigJson(config, pluginSpec);
  }

  formatConfigJson(config, pluginSpec) {
    return JSON.stringify(config, null, 2);
  }

  generateHooksJson(pluginSpec) {
    const hooks = this.buildHooksMap(pluginSpec);
    return JSON.stringify({
      description: `Hooks for gm ${this.label} extension`,
      hooks
    }, null, 2);
  }

  buildHooksMap(pluginSpec) {
    // Check if platform has custom hook command builder
    const customBuildHookCommand = this.buildHookCommand.bind(this);
    const usesCustomFormat = customBuildHookCommand('test-hook.js') !== null;

    if (usesCustomFormat) {
      return this.buildHooksMapCustom(this.cliConfig.hookEventNames, this.cliConfig.hookOutputFormat);
    }

    const hooksMap = TemplateBuilder.buildHooksMap(this.cliConfig.hookEventNames, this.cliConfig.hookOutputFormat);
    // Replace template variables with environment variable based on platform
    const envVar = this.cliConfig.env?.pluginRoot || 'PLUGIN_ROOT';
    this.replaceHookDirVar(hooksMap, envVar);
    return hooksMap;
  }

  buildHooksMapCustom(hookEventNames, hookOutputFormat = 'wrapped') {
    const hooks = {};
    const hookDefs = [
      { event: 'preTool', file: 'pre-tool-use-hook.js', timeout: 3600 },
<<<<<<< HEAD
      { event: 'sessionStart', file: 'session-start-hook.js', timeout: 10000 },
      { event: 'promptSubmit', file: 'prompt-submit-hook.js', timeout: 3600 },
=======
      { event: 'postTool', file: 'post-tool-use-hook.js', timeout: 30000 },
      { event: 'promptSubmit', file: 'prompt-submit-hook.js', timeout: 180000 },
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
      { event: 'stop', files: [
        { file: 'stop-hook.js', timeout: 300000 },
        { file: 'stop-hook-git.js', timeout: 60000 }
      ]}
    ];

    hookDefs.forEach(def => {
      const eventKey = hookEventNames[def.event];
<<<<<<< HEAD
=======
      if (!eventKey) return; // Skip hooks not defined in this adapter
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
      if (def.files) {
        const cmds = def.files.map(f => this.createCustomCommand(f.file, f.timeout));
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmds : [{ matcher: '*', hooks: cmds }];
      } else {
        const cmd = [this.createCustomCommand(def.file, def.timeout)];
<<<<<<< HEAD
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmd[0] : [{ matcher: '*', hooks: cmd }];
=======
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmd : [{ matcher: '*', hooks: cmd }];
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
      }
    });

    return hooks;
  }

  createCustomCommand(hookFile, timeout) {
    return {
      type: 'command',
      command: this.buildHookCommand(hookFile),
      timeout
    };
  }

  replaceHookDirVar(hooksMap, envVar) {
    Object.values(hooksMap).forEach(hookArray => {
      if (Array.isArray(hookArray)) {
        hookArray.forEach(hookGroup => {
          if (hookGroup.hooks && Array.isArray(hookGroup.hooks)) {
            hookGroup.hooks.forEach(hook => {
              if (hook.command && hook.command.includes('${__dirname}')) {
                hook.command = hook.command.replace('${__dirname}', `\${${envVar}}/hooks`);
              }
            });
          }
        });
      } else if (hookArray.command && hookArray.command.includes('${__dirname}')) {
        hookArray.command = hookArray.command.replace('${__dirname}', `\${${envVar}}/hooks`);
      }
    });
  }

  buildHookCommand(hookFile) {
    // Override point for platform-specific hook command format
    return null;
  }

  generateContextFile() {
    return `# ${path.basename(this.contextFile, '.md')}

## Technical Notes

Hook response format: \`{"decision":"allow|block","reason":"text"}\` with exit code 0.

Tool names for this platform: ${this.getToolNamesDescription()}

When filtering transcript history by sessionId, use: \`if (sessionId && entry.sessionId === sessionId)\`

Verification file \`.gm-stop-verified\` is auto-added to .gitignore and tracks session completion state.
`;
  }

  getToolNamesDescription() {
    const toolMap = this.cliConfig.tools;
    const names = Object.entries(toolMap)
      .map(([generic, platform]) => `\`${generic}\` → \`${platform}\``)
      .join(', ');
    return names;
  }

  generateReadme(pluginSpec) {
    return `# ${pluginSpec?.name || 'gm'} for ${this.label}

Copy the directory to your ${this.label} extensions path and restart.

The extension activates automatically on session start.
`;
  }

  getGenericFilesToUse() {
    return TemplateBuilder.getCliGenericFiles();
  }
}

module.exports = CLIAdapter;
