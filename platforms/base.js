const path = require('path');
const { writeFile, ensureDir } = require('../lib/file-generator');
const TemplateBuilder = require('../lib/template-builder');

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
    const genericFiles = this.getGenericFilesToUse();
    const withGeneric = { ...genericFiles, ...structure };
    return this.writeFiles(outputDir, withGeneric);
  }

  getGenericFilesToUse() {
    return TemplateBuilder.getGenericFiles();
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
    return TemplateBuilder.generatePackageJson(pluginSpec, this.name, extraFields);
  }

  generateMcpJson(pluginSpec) {
    return TemplateBuilder.generateMcpJson(pluginSpec);
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
    return [`agents/${agent}.md`, `gm-${this.name}/agents/${agent}.md`, `gm-cc/agents/${agent}.md`];
  }

  getSkillSourcePath(skillName) {
    return `skills/${skillName}/SKILL.md`;
  }
}

module.exports = PlatformAdapter;
