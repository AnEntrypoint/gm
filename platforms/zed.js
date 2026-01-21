const ExtensionAdapter = require('../lib/extension-adapter');
const { zedManifest } = require('./ide-manifests');

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
      'extension.json': this.generateExtensionManifest(pluginSpec),
      'settings.json': this.generateSettings(),
      'language.json': this.generateLanguageConfig(),
      'extension.js': this.generateExtensionEntry(),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'README.md': this.generateReadme()
    };
  }

  generateExtensionManifest(pluginSpec) {
    return JSON.stringify(zedManifest(pluginSpec), null, 2);
  }

  generateSettings() {
    return JSON.stringify({
      glootie: {
        enabled: true,
        autoActivate: true,
        logLevel: 'info',
        llm: 'claude-3-5-sonnet',
        contextWindow: 200000,
        temperature: 0.7,
        modelConfig: {
          type: 'anthropic',
          apiKey: '${ANTHROPIC_API_KEY}',
          model: 'claude-3-5-sonnet-20241022'
        }
      }
    }, null, 2);
  }

  generateLanguageConfig() {
    return JSON.stringify({
      languages: {
        markdown: { completion: true, highlights: true, diagnostics: true },
        json: { completion: true, validation: true },
        javascript: { completion: true, formatting: true, diagnostics: true },
        typescript: { completion: true, formatting: true, diagnostics: true },
        python: { completion: true, diagnostics: true }
      },
      glootieBehavior: {
        codeContextLines: 50,
        autoContextDetection: true,
        semanticSearch: true
      }
    }, null, 2);
  }

  generateExtensionEntry() {
    return `const zed = require('zed');

class GlootieExtension {
  constructor() {
    this.isActive = false;
    this.assistantEnabled = false;
    this.state = {};
  }

  async activate(context) {
    this.isActive = true;
    this.registerCommands();
    this.setupAssistant();
    this.setupLanguages();
  }

  registerCommands() {
    zed.commands.register('glootie:activate', () => {
      this.isActive = true;
      zed.notifications.show('info', 'Glootie activated');
    });
    zed.commands.register('glootie:deactivate', () => {
      this.isActive = false;
      zed.notifications.show('info', 'Glootie deactivated');
    });
    zed.commands.register('glootie:showState', () => {
      zed.panels.show('glootie.state', { focused: true });
    });
    zed.commands.register('glootie:toggleAssistant', () => {
      this.assistantEnabled = !this.assistantEnabled;
      const status = this.assistantEnabled ? 'enabled' : 'disabled';
      zed.notifications.show('info', \`AI Assistant \${status}\`);
    });
  }

  setupAssistant() {
    zed.assistant.onRequest(async (context) => {
      if (!this.isActive || !this.assistantEnabled) return null;
      return {
        model: zed.config.get('glootie.llm'),
        messages: context.messages,
        temperature: zed.config.get('glootie.temperature', 0.7)
      };
    });
  }

  setupLanguages() {
    const config = zed.config.get('glootie.languages', {});
    Object.entries(config).forEach(([lang, enabled]) => {
      if (enabled) {
        zed.languages.register(lang, {
          name: lang,
          capabilities: { completion: true, diagnostics: true }
        });
      }
    });
  }

  deactivate() {
    this.isActive = false;
  }
}

let glootie;
exports.activate = async (context) => {
  glootie = new GlootieExtension();
  await glootie.activate(context);
};
exports.deactivate = () => glootie && glootie.deactivate();
`;
  }

  generateReadme() {
    return `# Glootie for Zed

AI state machine for Zed Editor with native Claude 3.5 Sonnet support.

## Installation

1. Clone: \`~/.config/zed/extensions/glootie\`
2. Restart Zed
3. Auto-activates on startup

## Features

- Native Claude integration
- State machine with checkpointing
- Inline completion
- Semantic search
- Language support: JavaScript, TypeScript, Python

## Quick Start

- Cmd+Shift+P → "Activate State Machine"
- Cmd+Shift+P → "Toggle AI Assistant"
- View AI state: Cmd+Shift+P → "Show State"

## Configuration

Edit \`~/.config/zed/settings.json\`:

\`\`\`json
{
  "glootie": {
    "enabled": true,
    "autoActivate": true,
    "llm": "claude-3-5-sonnet"
  }
}
\`\`\`

## License

MIT
`;
  }
}

module.exports = ZedAdapter;
