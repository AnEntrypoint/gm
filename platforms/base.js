const path = require('path');
const { writeFile, ensureDir, copyDirectory } = require('../lib/file-generator');

class PlatformAdapter {
  constructor(config = {}) {
    this.name = config.name;
    this.label = config.label;
    this.configFile = config.configFile;
    this.contextFile = config.contextFile;
    this.hookEventNames = config.hookEventNames;
    this.hookOutputFormat = config.hookOutputFormat;
    this.tools = config.tools;
    this.env = config.env;
  }

  generate(pluginSpec, sourceDir, outputDir) {
    ensureDir(outputDir);
    const structure = this.createFileStructure(pluginSpec, sourceDir);
    this.writeFiles(outputDir, structure);

    // Copy skills directory if it exists
    const skillsSourceDir = path.join(sourceDir, 'skills');
    const skillsOutputDir = path.join(outputDir, 'skills');
    copyDirectory(skillsSourceDir, skillsOutputDir);

    return this.getGeneratedFiles(outputDir);
  }

  getGeneratedFiles(outputDir) {
    const fs = require('fs');
    const files = [];
    const walk = (dir) => {
      if (!require('fs').existsSync(dir)) return;
      require('fs').readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = require('fs').statSync(fullPath);
        const relative = path.relative(outputDir, fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          files.push(relative);
        }
      });
    };
    walk(outputDir);
    return files;
  }

  createFileStructure(pluginSpec, sourceDir) {
    throw new Error('createFileStructure must be implemented by subclass');
  }

  writeFiles(outputDir, structure) {
    const written = [];
    Object.entries(structure).forEach(([filePath, content]) => {
      if (content) {
        writeFile(path.join(outputDir, filePath), content);
        written.push(filePath);
      }
    });
    return written;
  }

  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: `${pluginSpec.name}-${this.name}`,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      keywords: pluginSpec.keywords,
      repository: {
        type: 'git',
        url: `https://github.com/AnEntrypoint/${pluginSpec.name}-${this.name}.git`
      },
      homepage: `https://github.com/AnEntrypoint/${pluginSpec.name}-${this.name}#readme`,
      bugs: {
        url: `https://github.com/AnEntrypoint/${pluginSpec.name}-${this.name}/issues`
      },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      ...extraFields
    }, null, 2);
  }

  generateMcpJson(pluginSpec) {
    return JSON.stringify({
      $schema: 'https://schemas.modelcontextprotocol.io/0.1.0/mcp.json',
      mcpServers: pluginSpec.mcp
    }, null, 2);
  }

  generateHooksJson(hookEventNames) {
    throw new Error('generateHooksJson must be implemented by subclass');
  }

  readSourceFile(sourceDir, paths) {
    const fs = require('fs');
    if (Array.isArray(paths)) {
      for (const p of paths) {
        const fullPath = path.join(sourceDir, p);
        try {
          return fs.readFileSync(fullPath, 'utf-8');
        } catch (e) {}
      }
      return null;
    }
    const fullPath = path.join(sourceDir, paths);
    try {
      return fs.readFileSync(fullPath, 'utf-8');
    } catch (e) {
      return null;
    }
  }

  getDefaultHooks(pluginSpec) {
    return Object.keys(pluginSpec.hooks).map(hookName => ({
      name: hookName,
      file: pluginSpec.hooks[hookName],
      event: this.hookEventNames[this.mapHookName(hookName)]
    }));
  }

  mapHookName(hookName) {
    const map = {
      'session-start': 'sessionStart',
      'pre-tool': 'preTool',
      'prompt-submit': 'promptSubmit',
      'stop': 'stop',
      'stop-git': 'stopGit'
    };
    return map[hookName] || hookName;
  }

  getAgentSourcePaths(agent) {
    return [`agents/${agent}.md`, `glootie-${this.name}/agents/${agent}.md`, `glootie-cc/agents/${agent}.md`];
  }
}

module.exports = PlatformAdapter;
