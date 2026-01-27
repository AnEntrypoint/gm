const ExtensionAdapter = require('../lib/extension-adapter');
const { vscodeManifest } = require('./ide-manifests');

class VSCodeAdapter extends ExtensionAdapter {
  constructor() {
    super({
      name: 'vscode',
      label: 'VSCode',
      configFile: 'package.json',
      manifestType: 'vscode'
    });
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    return {
      'package.json': this.generatePackageJson(pluginSpec),
      'extension.js': this.generateExtensionEntry(),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      '.vscodeignore': this.generateVscodeignore(),
      'README.md': this.generateReadme()
    };
  }

  generatePackageJson(pluginSpec) {
    const manifest = JSON.parse(vscodeManifest(pluginSpec));
    manifest.main = './extension.js';
    manifest.files = ['extension.js', 'agents/', 'skills/', 'README.md'];
    return JSON.stringify(manifest, null, 2);
  }

  generateExtensionEntry() {
    return `const vscode = require('vscode');

class GlootieExtension {
  constructor(context) {
    this.context = context;
    this.isActive = false;
  }

  async activate() {
    this.isActive = true;
    console.log('Glootie extension activated');
    this.registerCommands();
    this.registerViews();
    this.setupConfiguration();
  }

  registerCommands() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('glootie.activate', () => {
        vscode.window.showInformationMessage('Glootie activated');
      }),
      vscode.commands.registerCommand('glootie.deactivate', () => {
        vscode.window.showInformationMessage('Glootie deactivated');
      }),
      vscode.commands.registerCommand('glootie.showState', () => {
        vscode.window.showInformationMessage('Glootie state machine');
      })
    );
  }

  registerViews() {}

  setupConfiguration() {
    const config = vscode.workspace.getConfiguration('glootie');
    this.isActive = config.get('autoActivate', true);
  }

  deactivate() {
    this.isActive = false;
    console.log('Glootie extension deactivated');
  }
}

let glootie;

function activate(context) {
  glootie = new GlootieExtension(context);
  glootie.activate();
}

function deactivate() {
  if (glootie) {
    glootie.deactivate();
  }
}

module.exports = { activate, deactivate };
`;
  }

  generateVscodeignore() {
    return `.git
.gitignore
**/*.map
**/*.ts
!**/*.d.ts
node_modules
build
.vscodeignore
.prettierrc
*.config.*
CHANGELOG.md
LICENSE
CONTRIBUTING.md
`;
  }

  generateReadme() {
    return `# Glootie - GM State Machine for VSCode

An AI-powered state machine extension for Visual Studio Code with dynamic adaptation and autonomous decision-making.

## Features

- **State Machine**: Persistent state management with checkpointing and recovery
- **Autonomous Agents**: AI-driven agents for code analysis and development tasks
- **Hot Reload**: Zero-downtime updates to agent logic
- **Real-Time Debugging**: Inspect internal state and agent behavior
- **Code Search**: Semantic code search via integrated agents
- **Web Search**: LLM-powered web search capabilities

## Installation

1. Install from VSCode Extension Marketplace (search for "Glootie")
2. Or manually: Clone this repo and run \`vsce package\` then install the VSIX file

## Quick Start

Once installed, the extension activates automatically. Access Glootie via:
- Command palette: \`Ctrl+Shift+P\` → "Glootie: Activate"
- View: Look for "Glootie" panel in the Explorer sidebar

## Configuration

Configure via VSCode settings (\`settings.json\`):

\`\`\`json
{
  "glootie.enabled": true,
  "glootie.autoActivate": true,
  "glootie.logLevel": "info"
}
\`\`\`

## Development

See agents documentation in \`agents/\`:
- \`agents/gm.md\` - GM state machine agent
- \`agents/codesearch.md\` - Code search agent
- \`agents/websearch.md\` - Web search agent

## Publishing

Build and publish to VSCode Marketplace:

\`\`\`bash
npm install -g vsce
vsce publish
\`\`\`

## License

MIT
`;
  }
}

module.exports = VSCodeAdapter;
