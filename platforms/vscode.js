const ExtensionAdapter = require('../lib/extension-adapter');
const { vscodeManifest } = require('./ide-manifests');
const TemplateBuilder = require('../lib/template-builder');

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
    const structure = {
      'package.json': this.generatePackageJson(pluginSpec),
      'extension.js': this.generateExtensionEntry(),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      '.vscodeignore': this.generateVscodeignore(),
      'README.md': this.generateReadme()
    };
    const skills = this.loadSkillsFromSource(sourceDir);
    Object.assign(structure, skills);
    return structure;
  }

  loadSkillsFromSource(sourceDir) {
    return TemplateBuilder.loadSkillsFromSource(sourceDir, 'skills');
  }

  generatePackageJson(pluginSpec) {
    const manifest = JSON.parse(vscodeManifest(pluginSpec));
    manifest.main = './extension.js';
    manifest.files = ['extension.js', 'agents/', 'skills/', '.github/', 'README.md'];
    return JSON.stringify(manifest, null, 2);
  }

  generateExtensionEntry() {
    return `const vscode = require('vscode');

class GmExtension {
  constructor(context) {
    this.context = context;
    this.isActive = false;
  }

  async activate() {
    this.isActive = true;
    console.log('GM extension activated');
    this.registerCommands();
    this.registerViews();
    this.setupConfiguration();
    this.showCodeSearchInfo();
  }

  registerCommands() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('gm.activate', () => {
        vscode.window.showInformationMessage('GM activated');
      }),
      vscode.commands.registerCommand('gm.deactivate', () => {
        vscode.window.showInformationMessage('GM deactivated');
      }),
      vscode.commands.registerCommand('gm.showState', () => {
        vscode.window.showInformationMessage('GM state machine');
      })
    );
  }

  registerViews() {}

  setupConfiguration() {
    const config = vscode.workspace.getConfiguration('gm');
    this.isActive = config.get('autoActivate', true);
  }

  showCodeSearchInfo() {
    const message = 'GM uses semantic code search - describe intent ("find auth logic") not regex. Use code-search to explore your codebase across files. Open README.md for details.';
    vscode.window.showInformationMessage(message, 'Learn More').then(selection => {
      if (selection === 'Learn More') {
        vscode.commands.executeCommand('workbench.action.openAbstractDialog');
      }
    });
  }

  deactivate() {
    this.isActive = false;
    console.log('GM extension deactivated');
  }
}

let gm;

function activate(context) {
  gm = new GmExtension(context);
  gm.activate();
}

function deactivate() {
  if (gm) {
    gm.deactivate();
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
    return `# GM - GM State Machine for VSCode

An AI-powered state machine extension for Visual Studio Code with dynamic adaptation and autonomous decision-making.

## Features

- **State Machine**: Persistent state management with checkpointing and recovery
- **Autonomous Agents**: AI-driven agents for code analysis and development tasks
- **Hot Reload**: Zero-downtime updates to agent logic
- **Real-Time Debugging**: Inspect internal state and agent behavior
- **Code Search**: Semantic code search via integrated agents
- **Web Search**: LLM-powered web search capabilities

## Installation

1. Install from VSCode Extension Marketplace (search for "GM")
2. Or manually: Clone this repo and run \`vsce package\` then install the VSIX file

## Quick Start

Once installed, the extension activates automatically. Access GM via:
- Command palette: \`Ctrl+Shift+P\` → "GM: Activate"
- View: Look for "GM" panel in the Explorer sidebar

## Configuration

Configure via VSCode settings (\`settings.json\`):

\`\`\`json
{
  "gm.enabled": true,
  "gm.autoActivate": true,
  "gm.logLevel": "info"
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
