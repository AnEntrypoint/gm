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
    return [`agents/${agent}.md`, `glootie-copilot-cli/agents/${agent}.md`, `glootie-cc/agents/${agent}.md`];
  }

  getHookSourcePaths(hook) {
    const hookMap = {
      'pre-tool-use': ['pre-tool-use-hook.js', 'pre-tool.js'],
      'session-start': ['session-start-hook.js', 'session-start.js'],
      'prompt-submit': ['prompt-submit-hook.js', 'prompt-submit.js'],
      'stop': ['stop-hook.js', 'stop.js']
    };
    const hookFiles = hookMap[hook] || [`${hook}-hook.js`, `${hook}.js`];
    const paths = [];
    for (const file of hookFiles) {
      paths.push(`hooks/${file}`);
    }
    paths.push(`glootie-copilot-cli/hooks/${hook}-hook.js`);
    paths.push(`glootie-cc/hooks/${hook}.js`);
    return paths;
  }
}

module.exports = CopilotCLIAdapter;
