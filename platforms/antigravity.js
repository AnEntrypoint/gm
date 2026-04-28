const ExtensionAdapter = require('../lib/extension-adapter');
const { antigravityManifest } = require('./ide-manifests');
const TemplateBuilder = require('../lib/template-builder');

class AntigravityAdapter extends ExtensionAdapter {
  constructor() {
    super({
      name: 'antigravity',
      label: 'Antigravity',
      configFile: 'package.json',
      manifestType: 'antigravity'
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
      'README.md': this.generateReadme(),
      'index.html': TemplateBuilder.generateGitHubPage(TemplateBuilder.getPlatformPageConfig('antigravity', pluginSpec))
    };
    const skills = this.loadSkillsFromSource(sourceDir);
    Object.assign(structure, skills);
    return structure;
  }

  loadSkillsFromSource(sourceDir) {
    return TemplateBuilder.loadSkillsFromSource(sourceDir, 'skills');
  }

  generatePackageJson(pluginSpec) {
    const manifest = JSON.parse(antigravityManifest(pluginSpec));
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
    console.log('GM extension activated (Antigravity)');
    this.registerCommands();
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

  setupConfiguration() {
    const config = vscode.workspace.getConfiguration('gm');
    this.isActive = config.get('autoActivate', true);
  }

  showCodeSearchInfo() {
    const message = 'GM uses semantic code search - describe intent ("find auth logic") not regex. Use code-search to explore your codebase across files. Open README.md for details.';
    vscode.window.showInformationMessage(message);
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
    return `# GM - GM State Machine for Antigravity

An AI-powered state machine extension for Google Antigravity IDE with autonomous agent coordination.

## About Antigravity

Antigravity is Google's agentic IDE built on a fork of VS Code. It uses the OpenVSX registry and ships its own \`antigravity\` CLI for extension management. This extension is API-compatible with the VS Code extension surface.

## Features

- **State Machine**: PLAN → EXECUTE → EMIT → VERIFY → COMPLETE phases with full mutable tracking
- **Autonomous Agents**: gm, codesearch, and websearch agents pre-configured
- **Hot Reload**: Zero-downtime updates to agent logic
- **Real-Time Debugging**: Inspect internal state and agent behavior
- **Code Search**: Semantic code search via integrated agents
- **Web Search**: LLM-powered web search capabilities

## Installation

### From OpenVSX (recommended)

\`\`\`bash
antigravity --install-extension gm.gm-antigravity
\`\`\`

### From VSIX

\`\`\`bash
antigravity --install-extension gm-antigravity.vsix
\`\`\`

### From npm

\`\`\`bash
npm install -g gm-antigravity
\`\`\`

## Quick Start

Once installed, the extension activates automatically. Access GM via:

- Command palette: \`Ctrl+Shift+P\` → "GM: Activate"
- Settings: \`gm.enabled\`, \`gm.autoActivate\`, \`gm.logLevel\`

## License

MIT
`;
  }
}

module.exports = AntigravityAdapter;
