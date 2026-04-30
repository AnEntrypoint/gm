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
      'bin/install.js': this.generateBinInstaller(),
      '.vscodeignore': this.generateVscodeignore(),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
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
    manifest.bin = { 'gm-antigravity': './bin/install.js' };
    manifest.files = ['extension.js', 'bin/', 'agents/', 'skills/', '.vscodeignore', 'README.md'];
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

  generateBinInstaller() {
    return `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..');

function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip && skip(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

function buildVsix(stageDir) {
  copyDir(PKG_DIR, stageDir, (n) => n === 'node_modules' || n === '.git' || n === 'bin');
  const pkgPath = path.join(stageDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  delete pkg.files;
  delete pkg.bin;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log('[gm-antigravity] packaging VSIX in ' + stageDir);
  const args = ['--yes', '@vscode/vsce@latest', 'package',
    '--allow-star-activation', '--skip-license', '--no-dependencies', '--out', 'extension.vsix'];
  const r = spawnSync('npx', args, { cwd: stageDir, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('[gm-antigravity] vsce package failed (exit ' + r.status + ')');
    process.exit(5);
  }
  return path.join(stageDir, 'extension.vsix');
}

function findAntigravityCli() {
  const candidates = [];
  const exe = process.platform === 'win32' ? 'antigravity.cmd' : 'antigravity';
  const exeAlt = process.platform === 'win32' ? 'antigravity.exe' : null;
  const PATH = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) candidates.push(p);
    if (exeAlt) {
      const p2 = path.join(dir, exeAlt);
      if (fs.existsSync(p2)) candidates.push(p2);
    }
  }
  const home = os.homedir();
  const wellKnown = process.platform === 'win32' ? [
    path.join(home, 'AppData', 'Local', 'Programs', 'Antigravity', 'bin', 'antigravity.cmd'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Antigravity', 'bin', 'antigravity.exe'),
    'C:\\\\Program Files\\\\Antigravity\\\\bin\\\\antigravity.cmd',
    'C:\\\\Program Files\\\\Antigravity\\\\bin\\\\antigravity.exe'
  ] : process.platform === 'darwin' ? [
    '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity',
    path.join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app', 'bin', 'antigravity')
  ] : [
    '/usr/bin/antigravity',
    '/usr/local/bin/antigravity',
    '/opt/Antigravity/bin/antigravity',
    path.join(home, '.local', 'bin', 'antigravity')
  ];
  for (const p of wellKnown) if (fs.existsSync(p)) candidates.push(p);
  return candidates[0] || null;
}

function main() {
  const cli = findAntigravityCli();
  if (!cli) {
    console.error('[gm-antigravity] antigravity CLI not found. Install Google Antigravity IDE first: https://antigravity.google');
    console.error('  Searched PATH and standard install locations.');
    process.exit(3);
  }
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-antigravity-'));
  let vsix;
  try {
    vsix = buildVsix(stage);
  } catch (e) {
    console.error('[gm-antigravity] vsix build failed:', e && e.message);
    process.exit(5);
  }
  console.log('[gm-antigravity] using CLI: ' + cli);
  console.log('[gm-antigravity] installing: ' + vsix);
  const cmdArgs = process.platform === 'win32' ? ['--install-extension', '"' + vsix + '"', '--force'] : ['--install-extension', vsix, '--force'];
  const cmdCli = process.platform === 'win32' ? '"' + cli + '"' : cli;
  const r = spawnSync(cmdCli, cmdArgs, { stdio: 'inherit', shell: true });
  if (r.error) { console.error('[gm-antigravity] spawn failed:', r.error.message); process.exit(4); }
  try { fs.rmSync(stage, { recursive: true, force: true }); } catch (e) {}
  process.exit(r.status || 0);
}

main();
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
bin/**
index.html
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

\`\`\`bash
bunx gm-antigravity@latest
\`\`\`

or with npx:

\`\`\`bash
npx gm-antigravity@latest
\`\`\`

This downloads the package and runs the bundled installer, which calls \`antigravity --install-extension\` against the bundled \`.vsix\`. Requires Google Antigravity IDE to be installed (the \`antigravity\` CLI must be on PATH or in a standard install location).

### Manual install

\`\`\`bash
antigravity --install-extension gm-antigravity.vsix
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
