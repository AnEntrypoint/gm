const ExtensionAdapter = require('../lib/extension-adapter');
const { cursorManifest } = require('./ide-manifests');

class CursorAdapter extends ExtensionAdapter {
  constructor() {
    super({
      name: 'cursor',
      label: 'Cursor IDE',
      configFile: 'package.json',
      manifestType: 'cursor'
    });
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    return {
      'package.json': this.generatePackageJson(pluginSpec),
      '.cursor/mcp.json': this.generateCursorMcp(pluginSpec),
      '.cursorrules': this.generateCursorRules(),
      'extension.js': this.generateExtensionEntry(),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'README.md': this.generateReadme()
    };
  }

  generatePackageJson(pluginSpec) {
    const manifest = JSON.parse(cursorManifest(pluginSpec));
    manifest.main = './extension.js';
    manifest.files = ['.cursor/', 'extension.js', 'agents/', 'README.md'];
    return JSON.stringify(manifest, null, 2);
  }

  generateCursorMcp(pluginSpec) {
    return JSON.stringify({
      mcpServers: pluginSpec.mcp || {}
    }, null, 2);
  }

  generateCursorRules() {
    return `# Cursor Agent Rules

Follow these patterns for Cursor IDE integrations.

## Tool Usage
- Use cursor.extensions.* APIs for integration
- Register hooks in extension manifest
- Activate on workbench ready

## Agent Pattern
- Load agents from agents/
- Initialize on startup
`;
  }

  generateExtensionEntry() {
    return `const vscode = require('vscode');

let agents = {};

async function activate(context) {
  console.log('Cursor extension activated');

  try {
    const fsPath = context.extensionPath;
    const gm = require('./gm.md');
    const codesearch = require('./codesearch.md');
    const websearch = require('./websearch.md');

    agents = { gm, codesearch, websearch };
    context.subscriptions.push(
      vscode.commands.registerCommand('cursor.showAgents', () => {
        console.log('Available agents:', Object.keys(agents));
      })
    );
  } catch (e) {
    console.error('Failed to activate Cursor extension:', e);
  }
}

function deactivate() {
  console.log('Cursor extension deactivated');
}

module.exports = { activate, deactivate };
`;
  }

  generateReadme() {
    return `# Glootie Extension for Cursor IDE

Custom AI plugin for Cursor IDE with multi-platform support.

## Installation

1. Copy extension to \`.cursor/extensions/\`
2. Restart Cursor IDE
3. Extension activates automatically

## Features

- Custom agent definitions
- Integrated MCP support
- Session management

## Configuration

Edit \`.cursor/mcp.json\` to configure MCP servers.
`;
  }
}

module.exports = CursorAdapter;
