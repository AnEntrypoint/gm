const ExtensionAdapter = require('../lib/extension-adapter');
const gen = require('./zed-gen');

class ZedAdapter extends ExtensionAdapter {
  constructor() {
    super({
      name: 'zed',
      label: 'Zed Editor',
      configFile: 'extension.json',
      manifestType: 'zed'
    });
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    return {
      'extension.json': gen.generateExtensionManifest(pluginSpec),
      'settings.json': gen.generateSettings(),
      'language.json': gen.generateLanguageConfig(),
      'dist/extension.js': gen.generateExtensionEntry(),
      'dist/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'dist/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'dist/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'README.md': gen.generateReadme()
    };
  }

  generateExtensionManifest(pluginSpec) {
    return gen.generateExtensionManifest(pluginSpec);
  }

  getAgentSourcePaths(agent) {
    return [`glootie-zed/agents/${agent}.md`, `glootie-cc/agents/${agent}.md`];
  }
}

module.exports = ZedAdapter;
