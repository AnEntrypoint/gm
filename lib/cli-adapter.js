const PlatformAdapter = require('../platforms/base');
const path = require('path');
const fs = require('fs');
const TemplateBuilder = require('./template-builder');
const { buildHooksMapCustom, replaceHookDirVar } = require('./hook-builder');

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
      [this.contextFile]: '@AGENTS.md',
      'AGENTS.md': readFile(['AGENTS.md', 'CLAUDE.md']) || this.generateContextFile(),
      'README.md': this.generateReadme(pluginSpec),
      'package.json': packageJsonSource || this.generatePackageJson(pluginSpec, this.getPackageJsonFields()),
      'hooks/hooks.json': this.generateHooksJson(pluginSpec),
      'gm.json': readFile(['gm.json']),
      'index.html': TemplateBuilder.generateGitHubPage(TemplateBuilder.getPlatformPageConfig(this.name, pluginSpec)),
      ...this.getAdditionalFiles(pluginSpec, readFile)
    };
    Object.assign(structure, this.loadAgentsFromSource(sourceDir));
    const skills = this.loadSkillsFromSource(sourceDir);
    Object.assign(structure, skills);
    const scripts = this.loadScriptsFromSource(sourceDir);
    Object.assign(structure, scripts);
    const lang = this.loadLangFromSource(sourceDir);
    Object.assign(structure, lang);
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

  loadAgentsFromSource(sourceDir) {
    const agentsDir = path.join(sourceDir, 'agents');
    if (!fs.existsSync(agentsDir)) return {};
    return fs.readdirSync(agentsDir)
      .filter(f => f.endsWith('.md'))
      .reduce((acc, f) => {
        acc[`agents/${f}`] = fs.readFileSync(path.join(agentsDir, f), 'utf-8');
        return acc;
      }, {});
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
      return buildHooksMapCustom(
        this.cliConfig.hookEventNames,
        this.cliConfig.hookOutputFormat,
        this.createCustomCommand.bind(this),
        this.createCustomBootstrapCommand.bind(this)
      );
    }

    const hooksMap = TemplateBuilder.buildHooksMap(this.cliConfig.hookEventNames, this.cliConfig.hookOutputFormat);
    const envVar = this.cliConfig.env?.pluginRoot || 'PLUGIN_ROOT';
    replaceHookDirVar(hooksMap, envVar);
    return hooksMap;
  }

  createCustomBootstrapCommand() {
    return { type: 'command', command: this.buildBootstrapCommand(), timeout: 60000 };
  }

  buildBootstrapCommand() {
    return `sh \${CLAUDE_PLUGIN_ROOT}/scripts/bootstrap.sh`;
  }

  createCustomCommand(hookEvent, timeout) {
    return {
      type: 'command',
      command: this.buildHookCommand(hookEvent),
      timeout
    };
  }

  buildHookCommand(hookFile) {
    return null;
  }

  generateContextFile() {
    return `# AGENTS

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
