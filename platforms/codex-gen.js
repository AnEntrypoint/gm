module.exports = {
  generateExtensionManifest(pluginSpec) {
    return JSON.stringify({
      name: 'glootie-codex',
      version: pluginSpec.version,
      displayName: 'Glootie - GM State Machine',
      description: pluginSpec.description || 'AI-powered state machine for Codex with dynamic adaptation',
      author: pluginSpec.author || 'Glootie',
      license: pluginSpec.license || 'MIT',
      repository: {
        type: 'git',
        url: 'https://github.com/AnEntrypoint/glootie-codex.git'
      },
      bugs: {
        url: 'https://github.com/AnEntrypoint/glootie-codex/issues'
      },
      engines: {
        vscode: '^1.85.0'
      },
      categories: [
        'AI',
        'Other'
      ],
      activationEvents: ['*'],
      main: './dist/extension.js',
      files: [
        'dist/',
        'config.toml',
        'AGENTS.md',
        'README.md'
      ],
      keywords: [
        'ai',
        'state-machine',
        'gm',
        'glootie',
        'automation',
        'codex',
        'openai'
      ]
    }, null, 2);
  },

  generateExtensionEntry() {
    return `const vscode = require('vscode');

class CodexExtension {
  constructor(context) {
    this.context = context;
    this.isActive = false;
  }

  async activate() {
    this.isActive = true;
    console.log('Glootie Codex extension activated');

    this.registerCommands();
    this.setupConfiguration();
  }

  registerCommands() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('glootie.activate', () => {
        vscode.window.showInformationMessage('Glootie Codex activated');
      }),
      vscode.commands.registerCommand('glootie.deactivate', () => {
        vscode.window.showInformationMessage('Glootie Codex deactivated');
      }),
      vscode.commands.registerCommand('glootie.showState', () => {
        vscode.window.showInformationMessage('Glootie state machine');
      })
    );
  }

  setupConfiguration() {
    const config = vscode.workspace.getConfiguration('glootie');
    this.isActive = config.get('autoActivate', true);
  }

  deactivate() {
    this.isActive = false;
    console.log('Glootie Codex extension deactivated');
  }
}

let glootie;

function activate(context) {
  glootie = new CodexExtension(context);
  glootie.activate();
}

function deactivate() {
  if (glootie) {
    glootie.deactivate();
  }
}

module.exports = { activate, deactivate };
`;
  },

  generateConfigToml(pluginSpec) {
    let mcpServers = '';
    if (pluginSpec.mcp && Object.keys(pluginSpec.mcp).length > 0) {
      mcpServers = '\n' + Object.entries(pluginSpec.mcp).map(([name, config]) => {
        const lines = [`[mcp_servers.${name}]`];
        if (config.command) {
          lines.push(`command = "${Array.isArray(config.command) ? config.command.join('" "') : config.command}"`);
        }
        if (config.args) {
          const args = Array.isArray(config.args) ? config.args : [config.args];
          args.forEach(arg => lines.push(`args = "${arg}"`));
        }
        if (config.env) {
          Object.entries(config.env).forEach(([key, val]) => {
            lines.push(`env.${key} = "${val}"`);
          });
        }
        return lines.join('\n');
      }).join('\n\n');
    }

    return `[project]
name = "${pluginSpec.name}"
version = "${pluginSpec.version}"
description = "${pluginSpec.description || ''}"
author = "${pluginSpec.author || ''}"

[glootie]
enabled = true
autoActivate = true
logLevel = "info"
${mcpServers}
`;
  }
};
