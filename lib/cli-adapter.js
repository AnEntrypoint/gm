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
      'gm.json': readFile(['gm.json']),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'index.html': TemplateBuilder.generateGitHubPage(TemplateBuilder.getPlatformPageConfig(this.name, pluginSpec)),
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
      'cli.js',
      'index.html'
    ];
  }

  getHookSourcePaths(hook) {
    return [`hooks/${hook}-hook.js`];
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
    const customBuildHookCommand = this.buildHookCommand.bind(this);
    const usesCustomFormat = customBuildHookCommand('test-hook.js') !== null;

    if (usesCustomFormat) {
      return this.buildHooksMapCustom(this.cliConfig.hookEventNames, this.cliConfig.hookOutputFormat);
    }

    const hooksMap = TemplateBuilder.buildHooksMap(this.cliConfig.hookEventNames, this.cliConfig.hookOutputFormat);
    const envVar = this.cliConfig.env?.pluginRoot || 'PLUGIN_ROOT';
    this.replaceHookDirVar(hooksMap, envVar);
    return hooksMap;
  }

  buildHooksMapCustom(hookEventNames, hookOutputFormat = 'wrapped') {
    const hooks = {};
    const hookDefs = [
      { event: 'preTool', hookEvent: 'pre-tool-use', timeout: 3600 },
      { event: 'sessionStart', bootstrap: true, hookEvent: 'session-start', timeout: 180000 },
      { event: 'promptSubmit', hookEvent: 'prompt-submit', timeout: 60000 },
      { event: 'stop', hookEvents: [
        { hookEvent: 'stop', timeout: 300000 },
        { hookEvent: 'stop-git', timeout: 60000 }
      ]}
    ];

    hookDefs.forEach(def => {
      const eventKey = hookEventNames[def.event];
      if (!eventKey) return;
      if (def.hookEvents) {
        const cmds = def.hookEvents.map(h => this.createCustomCommand(h.hookEvent, h.timeout));
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmds : [{ matcher: '*', hooks: cmds }];
      } else {
        const cmds = [];
        if (def.bootstrap) cmds.push(this.createCustomBootstrapCommand());
        cmds.push(this.createCustomCommand(def.hookEvent, def.timeout));
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmds[0] : [{ matcher: '*', hooks: cmds }];
      }
    });

    return hooks;
  }

  createCustomBootstrapCommand() {
    return { type: 'command', command: this.buildBootstrapCommand(), timeout: 60000 };
  }

  buildBootstrapCommand() {
    return null;
  }

  createCustomCommand(hookEvent, timeout) {
    return {
      type: 'command',
      command: this.buildHookCommand(hookEvent),
      timeout
    };
  }

  replaceHookDirVar(hooksMap, envVar) {
    const replace = (cmd) => cmd
      .replace(/\$\{__dirname\}/g, `\${${envVar}}/hooks`)
      .replace(/\$\{__pluginroot__\}/g, `\${${envVar}}`);
    Object.values(hooksMap).forEach(hookArray => {
      if (Array.isArray(hookArray)) {
        hookArray.forEach(hookGroup => {
          if (hookGroup.hooks && Array.isArray(hookGroup.hooks)) {
            hookGroup.hooks.forEach(hook => { if (hook.command) hook.command = replace(hook.command); });
          }
        });
      } else if (hookArray.command) {
        hookArray.command = replace(hookArray.command);
      }
    });
  }

  buildHookCommand(hookFile) {
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
