const CLIAdapter = require('../lib/cli-adapter');
const gen = require('./copilot-cli-gen');
const { createCcPromptSubmitHook, createCcPreToolUseHook, createCcPostToolUseHook } = require('./cli-config-shared');

class CopilotCLIAdapter extends CLIAdapter {
  constructor() {
    super({
      name: 'copilot-cli',
      label: 'GitHub Copilot CLI',
      configFile: 'copilot-profile.md',
      contextFile: 'COPILOT.md',
      hookEventNames: {
        sessionStart: 'session:start',
        preTool: 'tool:invoke',
        promptSubmit: 'prompt:submit',
        stop: 'session:end',
        stopGit: 'session:end'
      },
      hookOutputFormat: 'json',
      tools: {
        bash: 'shell',
        write: 'file_write',
        glob: 'file_glob',
        grep: 'file_search',
        search: 'semantic_search'
      },
      env: {
        pluginRoot: 'COPILOT_EXTENSION_DIR',
        projectDir: 'COPILOT_PROJECT_DIR'
      }
    });
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    const structure = {
      'copilot-profile.md': gen.generateAgentProfile(pluginSpec),
      'tools.json': gen.generateToolsJson(pluginSpec),
      'manifest.yml': gen.generateManifest(pluginSpec),
      'package.json': this.generatePackageJson(pluginSpec, this.getPackageJsonFields()),
      '.mcp.json': this.generateMcpJson(pluginSpec),
      'hooks/hooks.json': this.generateHooksJson(pluginSpec),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/memorize.md': readFile(this.getAgentSourcePaths('memorize')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'hooks/prompt-submit-hook.js': createCcPromptSubmitHook(),
      'hooks/pre-tool-use-hook.js': createCcPreToolUseHook(),
      'hooks/post-tool-use-hook.js': createCcPostToolUseHook(),
      'cli.js': gen.generateCliJs(),
      'README.md': gen.generateReadme(),
      'index.html': require('../lib/template-builder').generateGitHubPage(require('../lib/template-builder').getPlatformPageConfig('copilot-cli', pluginSpec))
    };
    const skills = this.loadSkillsFromSource(sourceDir);
    Object.assign(structure, skills);
    return structure;
  }

  getPackageJsonMain() {
    return 'cli.js';
  }

  getPackageJsonFiles() {
    return [
      'cli.js',
      'agents/',
      'hooks/',
      'skills/',
      '.github/',
      'copilot-profile.md',
      'tools.json',
      'manifest.yml',
      '.mcp.json',
      'README.md',
      'index.html',
      this.contextFile
    ];
  }

  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'gm-copilot-cli',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      main: 'cli.js',
      bin: { 'gm-copilot-cli': './cli.js', 'gm-install': './install.js' },
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/gm-copilot-cli.git' },
      homepage: 'https://github.com/AnEntrypoint/gm-copilot-cli#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/gm-copilot-cli/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      files: [
        'cli.js',
        'agents/',
        'hooks/',
        'skills/',
        '.github/',
        'copilot-profile.md',
        'tools.json',
        'manifest.yml',
        '.mcp.json',
        'README.md',
        this.contextFile
      ],
      ...extraFields
    }, null, 2);
  }

  generateContextFile() {
    return `# Copilot CLI Context

Hook response: \`{"decision":"allow|block","reason":"text","data":{}}\` with exit code 0.

Tool mapping:
- bash → shell
- write → file_write
- glob → file_glob
- grep → file_search
- search → semantic_search

State in \`~/.gh/extensions/gm/state.json\`.
`;
  }

  getAgentSourcePaths(agent) {
    return [`agents/${agent}.md`, `gm-copilot-cli/agents/${agent}.md`, `gm-cc/agents/${agent}.md`];
  }

  getHookSourcePaths(hook) {
    return super.getHookSourcePaths(hook);
  }

  buildHookCommand(hookEvent) {
    const hookEventMap = { 'stop': 'session-end', 'stop-git': 'session-end-git' };
    const mappedEvent = hookEventMap[hookEvent] || hookEvent;
    return `\${COPILOT_EXTENSION_DIR}/bin/plugkit hook ${mappedEvent}`;
  }

  buildHooksMap() {
    const envVar = 'COPILOT_EXTENSION_DIR';
    const plugkit = `\${${envVar}}/bin/plugkit hook`;
    const hook = (h, t) => ({ type: 'command', command: `${plugkit} ${h}`, timeout: t });
    const jsHook = (f, t) => ({ type: 'command', command: `node \${${envVar}}/hooks/${f}`, timeout: t });
    const wrap = (cmds) => [{ matcher: '*', hooks: Array.isArray(cmds) ? cmds : [cmds] }];
    return {
      'tool:invoke': wrap([hook('pre-tool-use', 3600), jsHook('pre-tool-use-hook.js', 2000)]),
      'session:start': wrap(hook('session-start', 180000)),
      'prompt:submit': wrap([hook('prompt-submit', 60000), jsHook('prompt-submit-hook.js', 3000)]),
      'session:end': wrap([hook('session-end', 15000), hook('session-end-git', 210000)]),
    };
  }
}

module.exports = CopilotCLIAdapter;
