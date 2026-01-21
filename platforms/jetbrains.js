const ExtensionAdapter = require('../lib/extension-adapter');
const gen = require('./jetbrains-gen');

class JetBrainsAdapter extends ExtensionAdapter {
  constructor() {
    super({
      name: 'jetbrains',
      label: 'JetBrains IDEs',
      configFile: 'plugin.xml',
      manifestType: 'jetbrains'
    });
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    return {
      'plugin.xml': gen.generatePluginXml(pluginSpec),
      'build.gradle.kts': gen.generateBuildGradle(pluginSpec),
      'src/main/kotlin/com/glootie/GlootiePlugin.kt': gen.generatePluginClass(),
      'src/main/kotlin/com/glootie/GlootieToolWindow.kt': gen.generateToolWindow(),
      'src/main/resources/META-INF/plugin.xml': gen.generatePluginXml(pluginSpec),
      'README.md': gen.generateReadme(),
      'docs/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'docs/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'docs/websearch.md': readFile(this.getAgentSourcePaths('websearch'))
    };
  }

  generateExtensionManifest(pluginSpec) {
    return gen.generatePluginXml(pluginSpec);
  }

  getAgentSourcePaths(agent) {
    return [`glootie-jetbrains/agents/${agent}.md`, `glootie-cc/agents/${agent}.md`];
  }
}

module.exports = JetBrainsAdapter;
