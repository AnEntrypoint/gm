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
    const structure = {
      'copilot-profile.md': gen.generateAgentProfile(pluginSpec),
      'tools.json': gen.generateToolsJson(pluginSpec),
      'manifest.yml': gen.generateManifest(pluginSpec),
      'package.json': this.generatePackageJson(pluginSpec, this.getPackageJsonFields()),
      '.mcp.json': this.generateMcpJson(pluginSpec),
      'hooks/hooks.json': this.generateHooksJson(pluginSpec),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'hooks/pre-tool-use-hook.js': readFile(this.getHookSourcePaths('pre-tool-use')),
      'hooks/session-start-hook.js': readFile(this.getHookSourcePaths('session-start')),
      'hooks/prompt-submit-hook.js': readFile(this.getHookSourcePaths('prompt-submit')),
      'hooks/session-end-hook.js': readFile(this.getHookSourcePaths('stop')),
      'hooks/session-end-git-hook.js': readFile(this.getHookSourcePaths('stop-git')),
      'cli.js': gen.generateCliJs(),
      'README.md': gen.generateReadme()
    };
    const skills = this.loadSkillsFromSource(sourceDir);
    Object.assign(structure, skills);
    return structure;
  }

  loadSkillsFromSource(sourceDir) {
    const fs = require('fs');
    const path = require('path');
    const skillsDir = path.join(sourceDir, 'skills');
    const skills = {};

    if (!fs.existsSync(skillsDir)) {
      return skills;
    }

    try {
      fs.readdirSync(skillsDir).forEach(skillName => {
        const skillPath = path.join(skillsDir, skillName);
        const stat = fs.statSync(skillPath);
        if (stat.isDirectory()) {
          const skillMdPath = path.join(skillPath, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            skills[`skills/${skillName}/SKILL.md`] = content;
          }
        }
      });
    } catch (e) {}

    return skills;
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
      this.contextFile
    ];
  }

  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'glootie-copilot-cli',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      main: 'cli.js',
      bin: { 'glootie-copilot-cli': './cli.js', 'glootie-install': './install.js' },
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/glootie-copilot-cli.git' },
      homepage: 'https://github.com/AnEntrypoint/glootie-copilot-cli#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/glootie-copilot-cli/issues' },
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

State in \`~/.gh/extensions/glootie/state.json\`.
`;
  }

  getAgentSourcePaths(agent) {
    return [`agents/${agent}.md`, `glootie-copilot-cli/agents/${agent}.md`, `glootie-cc/agents/${agent}.md`];
  }

  getHookSourcePaths(hook) {
    // Use canonical hook naming: {name}-hook.js
    // Delegates to parent CLIAdapter for consistency
    return super.getHookSourcePaths(hook);
  }

  buildHookCommand(hookFile) {
    // Copilot CLI uses custom hook file naming
    const fileNameMap = {
      'stop-hook.js': 'session-end-hook.js',
      'stop-hook-git.js': 'session-end-git-hook.js'
    };
    const mappedFile = fileNameMap[hookFile] || hookFile;
    return `node \${COPILOT_EXTENSION_DIR}/hooks/${mappedFile}`;
  }
}

module.exports = CopilotCLIAdapter;
