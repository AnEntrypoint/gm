const factory = require('./cli-config-factory');
const path = require('path');
const fs = require('fs');


function createGeminiInstallScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) {
    return null;
  }

  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    const parent = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return parent;
    }
  }
  return null;
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) {
      return false;
    }

    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    entries.forEach(entry => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        safeCopyDirectory(srcPath, dstPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(srcPath, 'utf-8');
        const dstDir = path.dirname(dstPath);
        if (!fs.existsSync(dstDir)) {
          fs.mkdirSync(dstDir, { recursive: true });
        }
        fs.writeFileSync(dstPath, content, 'utf-8');
      }
    });
    return true;
  } catch (err) {
    return false;
  }
}

function install() {
  if (!isInsideNodeModules()) {
    return;
  }

  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    return;
  }

  const geminiDir = path.join(projectRoot, '.gemini', 'extensions', 'gm-gc');
  const sourceDir = __dirname;

  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(geminiDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(geminiDir, 'hooks'));
}

install();
`;
}
function createCodexInstallScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) {
    return null;
  }

  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    const parent = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return parent;
    }
  }
  return null;
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) {
      return false;
    }

    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    entries.forEach(entry => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        safeCopyDirectory(srcPath, dstPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(srcPath, 'utf-8');
        const dstDir = path.dirname(dstPath);
        if (!fs.existsSync(dstDir)) {
          fs.mkdirSync(dstDir, { recursive: true });
        }
        fs.writeFileSync(dstPath, content, 'utf-8');
      }
    });
    return true;
  } catch (err) {
    return false;
  }
}

function install() {
  if (!isInsideNodeModules()) {
    return;
  }

  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    return;
  }

  const codexDir = path.join(projectRoot, '.codex', 'plugins', 'gm');
  const sourceDir = __dirname;

  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(codexDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(codexDir, 'hooks'));
}

install();
`;
}
function createOpenCodeInstallScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) {
    return null;
  }

  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    const parent = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return parent;
    }
  }
  return null;
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) {
      return false;
    }

    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    entries.forEach(entry => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        safeCopyDirectory(srcPath, dstPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(srcPath, 'utf-8');
        const dstDir = path.dirname(dstPath);
        if (!fs.existsSync(dstDir)) {
          fs.mkdirSync(dstDir, { recursive: true });
        }
        fs.writeFileSync(dstPath, content, 'utf-8');
      }
    });
    return true;
  } catch (err) {
    return false;
  }
}

function install() {
  if (!isInsideNodeModules()) {
    return;
  }

  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    return;
  }

  const ocDir = path.join(projectRoot, '.config', 'opencode', 'plugin');
  const sourceDir = __dirname;

  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(ocDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(ocDir, 'hooks'));
}

install();
`;
}
function createKiloInstallScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) {
    return null;
  }

  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    const parent = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return parent;
    }
  }
  return null;
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) {
      return false;
    }

    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    entries.forEach(entry => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        safeCopyDirectory(srcPath, dstPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(srcPath, 'utf-8');
        const dstDir = path.dirname(dstPath);
        if (!fs.existsSync(dstDir)) {
          fs.mkdirSync(dstDir, { recursive: true });
        }
        fs.writeFileSync(dstPath, content, 'utf-8');
      }
    });
    return true;
  } catch (err) {
    return false;
  }
}

function install() {
  if (!isInsideNodeModules()) {
    return;
  }

  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    return;
  }

  const kiloDir = path.join(projectRoot, '.config', 'kilo', 'plugin');
  const sourceDir = __dirname;

  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(kiloDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(kiloDir, 'hooks'));
}

install();
`;
}
function createGeminiInstallerScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = process.platform === 'win32'
  ? path.join(homeDir, 'AppData', 'Roaming', 'gemini', 'extensions', 'gm')
  : path.join(homeDir, '.gemini', 'extensions', 'gm');

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading gm-gc...' : 'Installing gm-gc...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = [
    ['agents', 'agents'],
    ['hooks', 'hooks'],
    ['.mcp.json', '.mcp.json'],
    ['gemini-extension.json', 'gemini-extension.json'],
    ['README.md', 'README.md'],
    ['GEMINI.md', 'GEMINI.md']
  ];

  function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  filesToCopy.forEach(([src, dst]) => copyRecursive(path.join(srcDir, src), path.join(destDir, dst)));

  // Install skills globally via the skills package (supports all agents)
  const { execSync } = require('child_process');
  try {
    execSync('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Warning: skills install failed (non-fatal):', e.message);
  }

  const destPath = process.platform === 'win32'
    ? destDir.replace(/\\\\/g, '/')
    : destDir;
  console.log(\`✓ gm-gc \${isUpgrade ? 'upgraded' : 'installed'} to \${destPath}\`);
  console.log('Restart Gemini CLI to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
`;
}

function createOpenCodeInstallerScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const ocConfigDir = path.join(homeDir, '.config', 'opencode');
const srcDir = __dirname;
const pluginMarker = path.join(ocConfigDir, 'plugins', 'gm-oc.mjs');
const isUpgrade = fs.existsSync(pluginMarker);

console.log(isUpgrade ? 'Upgrading gm-oc...' : 'Installing gm-oc...');

try {
  fs.mkdirSync(path.join(ocConfigDir, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(ocConfigDir, 'agents'), { recursive: true });

  function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  // Install ESM plugin for opencode auto-loading from plugins directory
  fs.copyFileSync(path.join(srcDir, 'gm-oc.mjs'), path.join(ocConfigDir, 'plugins', 'gm-oc.mjs'));

  // Copy agents into opencode config dir
  copyRecursive(path.join(srcDir, 'agents'), path.join(ocConfigDir, 'agents'));

  // Write/update opencode.json — set default_agent
  const ocJsonPath = path.join(ocConfigDir, 'opencode.json');
  let ocConfig = {};
  try { ocConfig = JSON.parse(fs.readFileSync(ocJsonPath, 'utf-8')); } catch (e) {}
  // Remove stale MCP config (no longer used)
  delete ocConfig.mcp;
  ocConfig.default_agent = 'gm';
  fs.writeFileSync(ocJsonPath, JSON.stringify(ocConfig, null, 2) + '\\n');

  // Clean old AppData install location (no longer used by opencode)
  const oldDir = process.platform === 'win32'
    ? path.join(homeDir, 'AppData', 'Roaming', 'opencode', 'plugin') : null;
  if (oldDir && fs.existsSync(oldDir)) {
    try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch (e) {}
  }

  // Install skills globally via the skills package (supports all agents)
  const { execSync: execSync2 } = require('child_process');
  try {
    execSync2('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Warning: skills install failed (non-fatal):', e.message);
  }

  console.log(\`✓ gm-oc \${isUpgrade ? 'upgraded' : 'installed'} to \${ocConfigDir}\`);
  console.log('Restart OpenCode to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
`;
}

function createKiloInstallerScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const kiloConfigDir = path.join(homeDir, '.config', 'kilo');
const srcDir = __dirname;
const pluginMarker = path.join(kiloConfigDir, 'plugins', 'gm-kilo.mjs');
const isUpgrade = fs.existsSync(pluginMarker);

console.log(isUpgrade ? 'Upgrading gm-kilo...' : 'Installing gm-kilo...');

try {
  fs.mkdirSync(path.join(kiloConfigDir, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(kiloConfigDir, 'agents'), { recursive: true });

  function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  // Install ESM plugin for kilo auto-loading from plugins directory
  fs.copyFileSync(path.join(srcDir, 'gm-kilo.mjs'), path.join(kiloConfigDir, 'plugins', 'gm-kilo.mjs'));

  // Copy agents into kilo config dir
  copyRecursive(path.join(srcDir, 'agents'), path.join(kiloConfigDir, 'agents'));

  // Write/fix kilocode.json — set default_agent, fix $schema
  const kiloJsonPath = path.join(kiloConfigDir, 'kilocode.json');
  let kiloConfig = {};
  try {
    const raw = fs.readFileSync(kiloJsonPath, 'utf-8');
    kiloConfig = JSON.parse(raw);
    // Fix corrupted $schema key (written as "" in older versions)
    if (kiloConfig['']) { delete kiloConfig['']; }
  } catch (e) {}
  // Remove stale MCP config (no longer used)
  delete kiloConfig.mcp;
  kiloConfig['$schema'] = 'https://kilo.ai/config.json';
  kiloConfig.default_agent = 'gm';
  // Remove stale local-path plugin reference
  if (Array.isArray(kiloConfig.plugin)) {
    kiloConfig.plugin = kiloConfig.plugin.filter(p => !path.isAbsolute(p) && !p.startsWith('C:') && !p.startsWith('/'));
    if (kiloConfig.plugin.length === 0) delete kiloConfig.plugin;
  }
  fs.writeFileSync(kiloJsonPath, JSON.stringify(kiloConfig, null, 2) + '\\n');

  // Clean old AppData install location (no longer used by kilo)
  const oldDir = process.platform === 'win32'
    ? path.join(homeDir, 'AppData', 'Roaming', 'kilo', 'plugin') : null;
  if (oldDir && fs.existsSync(oldDir)) {
    try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch (e) {}
  }

  // Install skills globally via the skills package (supports all agents)
  const { execSync: execSync2 } = require('child_process');
  try {
    execSync2('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Warning: skills install failed (non-fatal):', e.message);
  }

  console.log(\`✓ gm-kilo \${isUpgrade ? 'upgraded' : 'installed'} to \${kiloConfigDir}\`);
  console.log('Restart Kilo CLI to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
`;
}

function createClaudeCodeCliScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = path.join(homeDir, '.claude');

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading gm-cc...' : 'Installing gm-cc...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = [
    ['agents', 'agents'],
    ['hooks', 'hooks'],
    ['.mcp.json', '.mcp.json'],
    ['README.md', 'README.md']
  ];

  function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  filesToCopy.forEach(([src, dst]) => copyRecursive(path.join(srcDir, src), path.join(destDir, dst)));

  // Install skills globally via the skills package (supports all agents)
  const { execSync } = require('child_process');
  try {
    execSync('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Warning: skills install failed (non-fatal):', e.message);
  }

  const destPath = process.platform === 'win32'
    ? destDir.replace(/\\\\/g, '/')
    : destDir;
  console.log(\`✓ gm-cc \${isUpgrade ? 'upgraded' : 'installed'} to \${destPath}\`);
  console.log('Restart Claude Code to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
`;
}

function createClaudeCodeInstallScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) {
    return null;
  }

  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    const parent = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return parent;
    }
  }
  return null;
}

function safeCopyFile(src, dst) {
  try {
    const content = fs.readFileSync(src, 'utf-8');
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }
    fs.writeFileSync(dst, content, 'utf-8');
    return true;
  } catch (err) {
    return false;
  }
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) {
      return false;
    }

    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    entries.forEach(entry => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        safeCopyDirectory(srcPath, dstPath);
      } else if (entry.isFile()) {
        safeCopyFile(srcPath, dstPath);
      }
    });
    return true;
  } catch (err) {
    return false;
  }
}

function updateGitignore(projectRoot) {
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const entry = '.gm-stop-verified';

    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }

    if (content.includes(entry)) {
      return true;
    }

    if (content && !content.endsWith('\\n')) {
      content += '\\n';
    }
    content += entry + '\\n';

    fs.writeFileSync(gitignorePath, content, 'utf-8');
    return true;
  } catch (err) {
    return false;
  }
}

function install() {
  if (!isInsideNodeModules()) {
    return;
  }

  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    return;
  }

  const claudeDir = path.join(projectRoot, '.claude');
  const sourceDir = __dirname.replace(/[\\/]scripts$/, '');

  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(claudeDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(claudeDir, 'hooks'));
  safeCopyFile(path.join(sourceDir, '.mcp.json'), path.join(claudeDir, '.mcp.json'));

  updateGitignore(projectRoot);
}

install();
`;
}

function createCodexCliScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = process.platform === 'win32'
  ? path.join(homeDir, 'AppData', 'Roaming', 'codex', 'plugins', 'gm')
  : path.join(homeDir, '.codex', 'plugins', 'gm');

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading gm-codex...' : 'Installing gm-codex...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = [
    ['agents', 'agents'],
    ['hooks', 'hooks'],
    ['.mcp.json', '.mcp.json'],
    ['plugin.json', 'plugin.json'],
    ['README.md', 'README.md']
  ];

  function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  filesToCopy.forEach(([src, dst]) => copyRecursive(path.join(srcDir, src), path.join(destDir, dst)));

  // Install skills globally via the skills package (supports all agents)
  const { execSync } = require('child_process');
  try {
    execSync('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Warning: skills install failed (non-fatal):', e.message);
  }

  const destPath = process.platform === 'win32'
    ? destDir.replace(/\\\\/g, '/')
    : destDir;
  console.log(\`✓ gm-codex \${isUpgrade ? 'upgraded' : 'installed'} to \${destPath}\`);
  console.log('Restart Codex to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
`;
}

const cc = factory('cc', 'Claude Code', 'CLAUDE.md', 'CLAUDE.md', {
  loadSkillsFromSource() { return {}; }, // Skills installed via `bunx skills add`, not bundled
  formatConfigJson(config) {
    return JSON.stringify({
      ...config,
      author: { name: config.author, url: 'https://github.com/AnEntrypoint' }
    }, null, 2);
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'gm-cc',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/gm-cc.git' },
      homepage: 'https://github.com/AnEntrypoint/gm-cc#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/gm-cc/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      bin: { 'gm-cc': './cli.js', 'gm-install': './install.js' },
      files: ['agents/', 'hooks/', 'scripts/', 'skills/', '.github/', '.mcp.json', '.claude-plugin/', 'plugin.json', 'README.md', 'LICENSE', '.gitignore', '.editorconfig', 'CONTRIBUTING.md', 'CLAUDE.md'],
      keywords: ['claude-code', 'agent', 'state-machine', 'mcp', 'automation', 'gm'],
      peerDependencies: { '@anthropic-ai/claude-code': '*' },
      scripts: pluginSpec.scripts,
      ...extraFields
    }, null, 2);
  },
  getPackageJsonFields() {
    return {
      files: ['agents/', 'hooks/', 'scripts/', 'skills/', '.github/', '.mcp.json', '.claude-plugin/', 'plugin.json', 'cli.js', 'install.js', 'README.md', 'LICENSE', '.gitignore', '.editorconfig', 'CONTRIBUTING.md', 'CLAUDE.md'],
      keywords: ['claude-code', 'agent', 'state-machine', 'mcp', 'automation', 'gm'],
      peerDependencies: { '@anthropic-ai/claude-code': '*' }
    };
  },
  getAdditionalFiles(spec) {
    const TemplateBuilder = require('../lib/template-builder');
    return {
      'plugin.json': TemplateBuilder.generatePluginJson(spec),
      '.claude-plugin/marketplace.json': TemplateBuilder.generateMarketplaceJson(spec),
      'cli.js': createClaudeCodeCliScript(),
      'install.js': createClaudeCodeInstallScript()
    };
  },
  generateReadme(spec) {
    const repoName = 'gm-cc';
    return `# ${repoName} for Claude Code

## Installation

### Plugin Marketplace Installation (Recommended)

The easiest way to install ${repoName} is through Claude Code's plugin marketplace:

\`\`\`bash
claude plugin marketplace add AnEntrypoint/${repoName}
claude plugin install -s user gm@${repoName}
\`\`\`

This installation method is best for:
- One-time plugin installation across all projects
- Always having the latest version
- Minimal setup and configuration
- Access to marketplace updates

### Repository Installation (Project-Specific)

For development or project-specific customization, install ${repoName} directly into your project:

\`\`\`bash
cd /path/to/your/project
npm install ${repoName} && npx gm install
\`\`\`

This installation method is ideal when you need to:
- Customize hooks or agents for your workflow
- Integrate with existing Claude Code projects
- Use the latest development version
- Configure platform-specific behavior per project

#### Installation Command Breakdown

The \`npm install ${repoName} && npx gm install\` command performs two steps:

1. **\`npm install ${repoName}\`** - Downloads the ${repoName} package and stores it in your project's \`node_modules/\` directory
2. **\`npx gm install\`** - Runs the gm installer that copies configuration files into your Claude Code plugin directory

**Expected output:**
\`\`\`
$ npm install ${repoName}
added 1 package in 1.2s

$ npx gm install
Installing ${repoName}...
✓ Created .claude/ directory
✓ Copied agents/gm.md
✓ Copied hooks to .claude/hooks/
✓ Created .mcp.json for MCP integration
\`\`\`

#### Installed File Structure (Project-Specific)

After running \`npx gm install\`, your project will have:

\`\`\`
.claude/
├── agents/
│   └── gm.md                 # State machine agent rules
├── hooks/
│   ├── pre-tool-use-hook.js  # Tool validation and filtering
│   ├── session-start-hook.js # Session initialization
│   ├── prompt-submit-hook.js # Prompt validation
│   ├── stop-hook.js          # Session completion enforcement
│   └── stop-hook-git.js      # Git state verification
└── .mcp.json                 # MCP server configuration
\`\`\`

Each hook runs automatically at the appropriate session event. No manual trigger needed.

## File Installation (Manual Setup)

If you prefer manual file management, clone the repository and copy files directly:

\`\`\`bash
# Clone the repository
git clone https://github.com/AnEntrypoint/${repoName}.git

# Copy to your Claude Code plugin directory
cp -r ./agents ~/.claude/agents
cp -r ./hooks ~/.claude/hooks
cp .mcp.json ~/.claude/.mcp.json
\`\`\`

## Environment Setup

\`\`\`bash
# Ensure you have Node.js and bun x installed
# bun x is required for hook execution
# It's bundled with Node.js 18+
which bun x
bun x --version
\`\`\`

## MCP Server Configuration

The \`.mcp.json\` file automatically configures:
- **dev**: Local code execution environment (uses \`bun x\`)
- **code-search**: Semantic code search via mcp-codebasesearch

No additional configuration needed.

## Configuration

### Option 1: Marketplace Installation (Default)

Marketplace installations use the default configuration. All settings work out-of-box:
- Hooks auto-detect file locations in .claude/hooks/
- MCP servers configured via included .mcp.json
- Agents loaded from .claude/agents/gm.md

### Option 2: Project-Specific Installation

For project customization:

1. **Edit agents/gm.md** to adjust behavioral rules
2. **Modify hooks** in .claude/hooks/ for custom behavior
3. **Update .mcp.json** to add or change MCP servers

Customizations are isolated to your project and won't affect other installations.

## Hook Enablement

Hooks run automatically once installed. To verify hooks are active:

1. Restart Claude Code
2. Start a new session
3. You should see hook output in the Claude Code terminal

If hooks don't activate:
- Check that .claude/hooks/ directory exists
- Verify hook files have executable permissions
- Ensure .mcp.json references the correct hook paths

## Update Procedures

### Plugin Marketplace Installation

\`\`\`bash
# Method 1: Via Claude Code commands
claude plugin marketplace update gm-cc
claude plugin update gm@gm-cc

# Method 2: Manual update
npm install -g ${repoName}@latest
\`\`\`

### Project-Specific Installation

\`\`\`bash
# Update the package
npm update ${repoName}

# Re-run the installer to update .claude/ directory
npx gm install

# Or manually copy updated files
cp -r node_modules/${repoName}/agents/* .claude/agents/
cp -r node_modules/${repoName}/hooks/* .claude/hooks/
cp node_modules/${repoName}/.mcp.json .claude/.mcp.json
\`\`\`

## Features

- **State machine agent** - Complete behavioral rule system for development
- **Five enforcement hooks** - Validation, prompts, startup, completion, git enforcement
- **MCP integration** - Code execution and semantic code search
- **Automatic thorns analysis** - AST analysis on session start
- **.prd enforcement** - Completion blocking at session end
- **Dual-mode installation** - Both user-wide (marketplace) and project-specific (npm)
- **Automatic setup** - No manual configuration needed
- **Convention-driven** - Works with existing code structure

## Troubleshooting

### Hooks not running

**Symptom:** Hooks don't execute when expected

**Solutions:**
1. Verify .claude/hooks/ directory exists: \`ls -la ~/.claude/hooks/\`
2. Check hook files are executable: \`chmod +x ~/.claude/hooks/*.js\`
3. Restart Claude Code completely
4. Check if hooks are loaded: Look for hook output in Claude Code terminal

### MCP servers not available

**Symptom:** Code execution or search tools don't work

**Solutions:**
1. Verify .mcp.json exists: \`cat ~/.claude/.mcp.json\`
2. Check MCP configuration references correct paths
3. Ensure bun x is installed: \`which bun x\`
4. Restart Claude Code and retry

### Plugin not appearing in marketplace

**Symptom:** Plugin doesn't show in \`claude plugin marketplace list\`

**Solutions:**
1. Check plugin is published: \`npm view ${repoName}\`
2. Verify package.json has correct plugin metadata
3. Check .claude-plugin/marketplace.json is valid JSON
4. Wait 5-10 minutes for marketplace index to refresh

### Permission denied errors

**Symptom:** "Permission denied" when running hooks

**Solutions:**
1. Make hook files executable: \`chmod +x ~/.claude/hooks/*.js\`
2. Check parent directories are readable: \`chmod 755 ~/.claude ~/.claude/hooks\`
3. Verify Claude Code process has file access

### Installation failed with npm

**Symptom:** \`npm install\` fails with network or permission errors

**Solutions:**
1. Check internet connection
2. Clear npm cache: \`npm cache clean --force\`
3. Use \`npm install\` with \`--legacy-peer-deps\` if needed
4. Check disk space: \`df -h\`
5. Run \`npm audit fix\` to resolve dependency issues

## Uninstall

### Plugin Marketplace

\`\`\`bash
claude plugin remove gm@gm-cc
\`\`\`

### Project-Specific

\`\`\`bash
# Remove from project
npm uninstall ${repoName}

# Remove configuration
rm -rf .claude/
\`\`\`

## Installation Comparison

| Method | Setup Time | Scope | Updates | Best For |
|--------|-----------|-------|---------|----------|
| **Marketplace** | 2 minutes | User-wide | One-click | Most users, all projects |
| **Project Installation** | 5 minutes | Per-project | \`npm update\` | Custom configurations |
| **File Installation** | 10 minutes | Per-project | Manual | Advanced users, offline setup |

## Contributing

Issues and pull requests welcome: [GitHub Issues](https://github.com/AnEntrypoint/${repoName}/issues)

## License

MIT - See LICENSE file for details
`;
  }
});

const gc = factory('gc', 'Gemini CLI', 'gemini-extension.json', 'GEMINI.md', {
  loadSkillsFromSource() { return {}; }, // Skills installed via `bunx skills add`, not bundled
  formatConfigJson(config) {
    return JSON.stringify({ ...config, contextFileName: this.contextFile }, null, 2);
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'gm-gc',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/gm-gc.git' },
      homepage: 'https://github.com/AnEntrypoint/gm-gc#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/gm-gc/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      bin: { 'gm-gc': './cli.js', 'gm-gc-install': './install.js' },
      files: ['agents/', 'hooks/', '.github/', 'README.md', 'GEMINI.md', '.mcp.json', 'gemini-extension.json', 'cli.js', 'install.js'],
      ...(pluginSpec.scripts && { scripts: pluginSpec.scripts }),
      ...extraFields
    }, null, 2);
  },
  getPackageJsonFields() {
    return {
      bin: { 'gm-gc': './cli.js', 'gm-gc-install': './install.js' },
      files: ['agents/', 'hooks/', '.github/', 'README.md', 'GEMINI.md', '.mcp.json', 'gemini-extension.json', 'cli.js']
    };
  },
  getAdditionalFiles(pluginSpec) {
    return {
      'cli.js': createGeminiInstallerScript(),
      'install.js': createGeminiInstallScript()
    };
  },
  buildHookCommand(hookFile) {
    return `node \${extensionPath}/hooks/${hookFile}`;
  },
  generateReadme(spec) {
    return `# ${spec.name} for Gemini CLI\n\n## Installation\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/gm-gc ~/.gemini/extensions/${spec.name}\n\`\`\`\n\n**Windows PowerShell:**\n\`\`\`powershell\ngit clone https://github.com/AnEntrypoint/gm-gc \"\\$env:APPDATA\\gemini\\extensions\\${spec.name}\"\n\`\`\`\n\n## Automatic Path Resolution\n\nHooks automatically use \`\${extensionPath}\` for path resolution. No manual environment variable setup required. The extension is fully portable.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe extension activates automatically on session start.\n`;
  }
});

const codex = factory('codex', 'Codex', 'plugin.json', 'CLAUDE.md', {
  loadSkillsFromSource() { return {}; }, // Skills installed via `bunx skills add`, not bundled
  formatConfigJson(config) {
    return JSON.stringify({
      ...config,
      author: { name: config.author, url: 'https://github.com/AnEntrypoint' },
      hooks: './hooks/hooks.json'
    }, null, 2);
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'gm-codex',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      main: 'plugin.json',
      bin: { 'gm-codex': './cli.js', 'gm-codex-install': './install.js' },
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/gm-codex.git' },
      homepage: 'https://github.com/AnEntrypoint/gm-codex#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/gm-codex/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      files: ['hooks/', 'agents/', '.github/', 'README.md', 'CLAUDE.md', '.mcp.json', 'plugin.json', 'pre-tool-use-hook.js', 'session-start-hook.js', 'prompt-submit-hook.js', 'stop-hook.js', 'stop-hook-git.js', 'cli.js', 'install.js'],
      keywords: ['codex', 'claude-code', 'wfgy', 'mcp', 'automation', 'gm'],
      ...(pluginSpec.scripts && { scripts: pluginSpec.scripts }),
      ...extraFields
    }, null, 2);
  },
  getPackageJsonMain() { return 'plugin.json'; },
  getPackageJsonFields() {
    return {
      main: 'plugin.json',
      bin: { 'gm-codex': './cli.js', 'gm-codex-install': './install.js' },
      files: ['hooks/', 'agents/', '.github/', 'README.md', 'CLAUDE.md', '.mcp.json', 'plugin.json', 'cli.js', 'pre-tool-use-hook.js', 'session-start-hook.js', 'prompt-submit-hook.js', 'stop-hook.js', 'stop-hook-git.js'],
      keywords: ['codex', 'claude-code', 'wfgy', 'mcp', 'automation', 'gm']
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for Codex\n\n## Installation\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/gm-codex ~/.codex/plugins/${spec.name}\n\`\`\`\n\n**Windows PowerShell:**\n\`\`\`powershell\ngit clone https://github.com/AnEntrypoint/gm-codex \"\\$env:APPDATA\\codex\\plugins\\${spec.name}\"\n\`\`\`\n\n## Environment\n\nSet CODEX_PLUGIN_ROOT to your plugin directory in your shell profile.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  },
  getAdditionalFiles(spec) {
    return {
      'cli.js': createCodexCliScript(),
      'install.js': createCodexInstallScript()
    };
  }
});

function ocPluginSource() {
  // CJS stub kept for npm package main field compatibility
  return `module.exports = require('./gm-oc.mjs');\n`;
}

function ocPluginMjsSource() {
  const lines = [
    "import { readFileSync, existsSync } from 'fs';",
    "import { join, dirname } from 'path';",
    "import { fileURLToPath } from 'url';",
    "",
    "const __dirname = dirname(fileURLToPath(import.meta.url));",
    "",
    "export async function GmPlugin({ directory }) {",
    "  const agentMd = join(__dirname, '..', 'agents', 'gm.md');",
    "  const prdFile = join(directory, '.prd');",
    "",
    "  return {",
    "    'experimental.chat.system.transform': async (input, output) => {",
    "      try {",
    "        const rules = readFileSync(agentMd, 'utf-8');",
    "        if (rules) output.system.unshift(rules);",
    "      } catch (e) {}",
    "      try {",
    "        if (existsSync(prdFile)) {",
    "          const prd = readFileSync(prdFile, 'utf-8').trim();",
    "          if (prd) output.system.push('\\nPENDING WORK (.prd):\\n' + prd);",
    "        }",
    "      } catch (e) {}",
    "    }",
    "  };",
    "}",
  ];
  return lines.join('\n') + '\n';
}

const oc = factory('oc', 'OpenCode', 'opencode.json', 'GM.md', {
  loadSkillsFromSource() { return {}; }, // Skills installed via `bunx skills add`, not bundled
  getPackageJsonFields() {
    return {
      main: 'gm.js',
      bin: { 'gm-oc': './cli.js', 'gm-oc-install': './install.js' },
      files: ['agents/', 'hooks/', 'scripts/', 'gm.js', 'gm-oc.mjs', 'index.js', 'opencode.json', '.github/', 'README.md', 'cli.js', 'install.js', 'LICENSE', 'CONTRIBUTING.md', '.gitignore', '.editorconfig'],
      keywords: ['opencode', 'opencode-plugin', 'automation', 'gm'],
      dependencies: {}
    };
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'gm-oc',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      main: 'gm-oc.mjs',
      bin: { 'gm-oc': './cli.js', 'gm-oc-install': './install.js' },
      keywords: ['opencode', 'opencode-plugin', 'automation', 'gm'],
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/gm-oc.git' },
      homepage: 'https://github.com/AnEntrypoint/gm-oc#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/gm-oc/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      dependencies: {},
      scripts: { postinstall: 'node scripts/postinstall.js' },
      files: ['agents/', 'hooks/', 'scripts/', 'gm.js', 'gm-oc.mjs', 'index.js', 'opencode.json', '.github/', 'README.md', 'cli.js', 'install.js', 'LICENSE', 'CONTRIBUTING.md', '.gitignore', '.editorconfig'],
      ...(pluginSpec.scripts && { scripts: pluginSpec.scripts }),
      ...extraFields
    }, null, 2);
  },
  formatConfigJson(config, pluginSpec) {
    const ocConfig = {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'gm'
    };
    return JSON.stringify(ocConfig, null, 2);
  },
  getAdditionalFiles(pluginSpec) {
    return {
      'index.js': `module.exports = { GmPlugin: require('./gm-oc.mjs').GmPlugin };\n`,
      'gm.js': ocPluginSource(),
      'gm-oc.mjs': ocPluginMjsSource(),
      'cli.js': createOpenCodeInstallerScript(),
      'install.js': createOpenCodeInstallScript(),
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for OpenCode\n\n## Installation\n\n### One-liner (recommended)\n\nInstall directly from npm using bun x:\n\n\`\`\`bash\nbun x gm-oc@latest\n\`\`\`\n\nThis command will automatically install gm-oc to the correct location for your platform and restart OpenCode to activate.\n\n### Manual installation\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/gm-oc ~/.config/opencode/plugin && cd ~/.config/opencode/plugin && bun install\n\`\`\`\n\n**Windows PowerShell:**\n\`\`\`powershell\ngit clone https://github.com/AnEntrypoint/gm-oc \"\\$env:APPDATA\\opencode\\plugin\" && cd \"\\$env:APPDATA\\opencode\\plugin\" && bun install\n\`\`\`\n\n### Project-level\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/gm-oc .opencode/plugins && cd .opencode/plugins && bun install\n\`\`\`\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Git enforcement on session idle\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  }
});

function kiloPluginSource() {
  // CJS stub kept for npm package main field compatibility
  return `module.exports = require('./gm-kilo.mjs');\n`;
}

function kiloPluginMjsSource() {
  const lines = [
    "import { readFileSync, existsSync } from 'fs';",
    "import { join, dirname } from 'path';",
    "import { fileURLToPath } from 'url';",
    "",
    "const __dirname = dirname(fileURLToPath(import.meta.url));",
    "",
    "export async function GmPlugin({ directory }) {",
    "  const agentMd = join(__dirname, '..', 'agents', 'gm.md');",
    "  const prdFile = join(directory, '.prd');",
    "",
    "  return {",
    "    'experimental.chat.system.transform': async (input, output) => {",
    "      try {",
    "        const rules = readFileSync(agentMd, 'utf-8');",
    "        if (rules) output.system.unshift(rules);",
    "      } catch (e) {}",
    "      try {",
    "        if (existsSync(prdFile)) {",
    "          const prd = readFileSync(prdFile, 'utf-8').trim();",
    "          if (prd) output.system.push('\\nPENDING WORK (.prd):\\n' + prd);",
    "        }",
    "      } catch (e) {}",
    "    }",
    "  };",
    "}",
  ];
  return lines.join('\n') + '\n';
}


const kilo = factory('kilo', 'Kilo CLI', 'kilocode.json', 'KILO.md', {
  loadSkillsFromSource() { return {}; }, // Skills installed via `bunx skills add`, not bundled
  getPackageJsonFields() {
    return {
      main: 'gm.js',
      bin: { 'gm-kilo': './cli.js', 'gm-kilo-install': './install.js' },
      files: ['agents/', 'hooks/', 'scripts/', 'gm.js', 'gm-kilo.mjs', 'index.js', 'kilocode.json', '.github/', 'README.md', 'cli.js', 'install.js', 'LICENSE', 'CONTRIBUTING.md', '.gitignore', '.editorconfig'],
      keywords: ['kilo', 'kilo-cli', 'automation', 'gm'],
      dependencies: {}
    };
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'gm-kilo',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      main: 'gm-kilo.mjs',
      bin: { 'gm-kilo': './cli.js', 'gm-kilo-install': './install.js' },
      keywords: ['kilo', 'kilo-cli', 'mcp', 'automation', 'gm'],
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/gm-kilo.git' },
      homepage: 'https://github.com/AnEntrypoint/gm-kilo#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/gm-kilo/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      dependencies: {},
      scripts: { postinstall: 'node scripts/postinstall.js' },
      files: ['agents/', 'hooks/', 'scripts/', 'gm.js', 'gm-kilo.mjs', 'index.js', 'kilocode.json', '.github/', 'README.md', 'cli.js', 'install.js', 'LICENSE', 'CONTRIBUTING.md', '.gitignore', '.editorconfig'],
      ...extraFields
    }, null, 2);
  },
  formatConfigJson(config, pluginSpec) {
    const kiloConfig = {
      $schema: 'https://kilo.ai/config.json',
      default_agent: 'gm'
    };
    return JSON.stringify(kiloConfig, null, 2);
  },
  getAdditionalFiles(pluginSpec) {
    return {
      'index.js': `module.exports = { GmPlugin: require('./gm-kilo.mjs').GmPlugin };\n`,
      'gm.js': kiloPluginSource(),
      'gm-kilo.mjs': kiloPluginMjsSource(),
      'cli.js': createKiloInstallerScript(),
      'install.js': createKiloInstallScript(),
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for Kilo CLI

## Installation

### One-liner (recommended)

Install directly from npm using bun x:

\`\`\`bash
bun x gm-kilo@latest
\`\`\`

This command will automatically install gm-kilo to the correct location for your platform and restart Kilo to activate.

### Manual installation

**Windows and Unix:**
\`\`\`bash
git clone https://github.com/AnEntrypoint/gm-kilo ~/.config/kilo/plugin && cd ~/.config/kilo/plugin && bun install
\`\`\`

**Windows PowerShell:**
\`\`\`powershell
git clone https://github.com/AnEntrypoint/gm-kilo "\\\$env:APPDATA\\kilo\\plugin" && cd "\\\$env:APPDATA\\kilo\\plugin" && bun install
\`\`\`

### Step 2: Configure MCP Servers

Kilo uses the OpenCode configuration format. Create or update \`~/.config/kilo/opencode.json\`:

\`\`\`json
{
  "\\\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "dev": {
      "type": "local",
      "command": ["bun x", "mcp-gm@latest"],
      "timeout": 360000,
      "enabled": true
    },
    "code-search": {
      "type": "local",
      "command": ["bun x", "codebasesearch@latest"],
      "timeout": 360000,
      "enabled": true
    }
  }
}
\`\`\`

### Step 3: Update Kilo Configuration

Update \`~/.config/kilo/kilocode.json\` to reference the plugin:

\`\`\`json
{
  "\\\$schema": "https://kilo.ai/config.json",
  "default_agent": "gm",
  "plugin": ["/home/user/.config/kilo/plugin"]
}
\`\`\`

Replace \`/home/user\` with your actual home directory path.

### Step 4: Verify Installation

Start Kilo and verify the tools appear:
\`\`\`bash
kilo
\`\`\`

Check MCP tools are connected:
\`\`\`bash
kilo mcp list
\`\`\`

You should see \`dev\` and \`code-search\` marked as connected.

## Features

- **MCP tools** - Code execution (\`dev\`) and semantic search (\`code-search\`)
- **State machine agent** - Complete \`gm\` behavioral rule system
- **Git enforcement** - Blocks uncommitted changes and unpushed commits on session idle
- **AST analysis** - Automatic codebase analysis via mcp-thorns on session start
- **.prd enforcement** - Blocks exit if work items remain in .prd file

## Troubleshooting

**MCP tools not appearing:**
- Verify \`~/.config/kilo/opencode.json\` exists with correct MCP server definitions
- Check that \`plugin\` path in \`kilocode.json\` points to the correct directory
- Run \`kilo mcp list\` to verify servers are connected
- Restart Kilo CLI completely

**Plugin not loading:**
- Verify plugin path in \`kilocode.json\` is absolute (e.g., \`/home/user/.config/kilo/plugin\`, not relative)
- Check \`index.js\` and \`gm.mjs\` exist in the plugin directory
- Run \`bun install\` in the plugin directory to ensure dependencies are installed

The plugin activates automatically on session start once MCP servers are configured.
`;
  }
});

module.exports = { cc, gc, codex, oc, kilo };
