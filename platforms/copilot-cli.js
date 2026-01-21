const CLIAdapter = require('../lib/cli-adapter');
const gen = require('./copilot-cli-gen');

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
    return {
      'copilot-profile.md': gen.generateAgentProfile(pluginSpec),
      'tools.json': gen.generateToolsJson(pluginSpec),
      'manifest.yml': gen.generateManifest(pluginSpec),
      'package.json': this.generatePackageJson(pluginSpec, this.getPackageJsonFields()),
      '.mcp.json': this.generateMcpJson(pluginSpec),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'hooks/pre-tool-use-hook.js': readFile(this.getHookSourcePaths('pre-tool-use')),
      'hooks/session-start-hook.js': readFile(this.getHookSourcePaths('session-start')),
      'hooks/prompt-submit-hook.js': readFile(this.getHookSourcePaths('prompt-submit')),
      'hooks/session-end-hook.js': readFile(this.getHookSourcePaths('stop')),
      'cli.js': gen.generateCliJs(),
      'README.md': gen.generateReadme()
    };
  }

  getPackageJsonMain() {
    return 'cli.js';
  }

  getPackageJsonFiles() {
    return [
      'cli.js',
      'agents/',
      'hooks/',
      'copilot-profile.md',
      'tools.json',
      'manifest.yml',
      '.mcp.json',
      'README.md',
      this.contextFile
    ];
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

State in \`~/.gh/extensions/glootie/state.json\`.
`;
  }

  getAgentSourcePaths(agent) {
    return [`glootie-copilot-cli/agents/${agent}.md`, `glootie-cc/agents/${agent}.md`];
  }

  getHookSourcePaths(hook) {
    return [`glootie-copilot-cli/hooks/${hook}-hook.js`];
  }
}

module.exports = CopilotCLIAdapter;
