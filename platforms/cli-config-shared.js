const factory = require('./cli-config-factory');
const TemplateBuilder = require('../lib/template-builder');

// Shared boilerplate embedded in generated install scripts (postinstall / npm install path)
const NODE_MODULES_HELPERS = `
function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) return null;
  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    if (path.basename(current) === 'node_modules') return path.dirname(current);
  }
  return null;
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach(entry => {
      const s = path.join(src, entry.name), d = path.join(dst, entry.name);
      if (entry.isDirectory()) safeCopyDirectory(s, d);
      else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); try { fs.chmodSync(d, fs.statSync(s).mode); } catch (e) {} }
    });
    return true;
  } catch (e) { return false; }
}`.trim();


const COPY_RECURSIVE_FN = `
  function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }`.trim();

const COPY_RECURSIVE_INLINE = COPY_RECURSIVE_FN;

const AUTO_UPDATE_CC = `
  const knownMarketplacesPath = path.join(homeDir, '.claude', 'plugins', 'known_marketplaces.json');
  try {
    const km = JSON.parse(fs.readFileSync(knownMarketplacesPath, 'utf-8'));
    if (km && km['gm-cc'] && km['gm-cc'].source && km['gm-cc'].installLocation) {
      km['gm-cc'].autoUpdate = true;
      km['gm-cc'].lastUpdated = new Date().toISOString();
      fs.writeFileSync(knownMarketplacesPath, JSON.stringify(km, null, 2) + '\\n');
    }
  } catch (e) {}`.trim();

function installScriptNodeModules(dirExpr, dirs) {
  const copies = dirs.map(([src, dst]) =>
    `  safeCopyDirectory(path.join(sourceDir, '${src}'), path.join(${dirExpr}, '${dst}'));`
  ).join('\n');
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

${NODE_MODULES_HELPERS}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  const destDir = path.join(projectRoot, ${dirExpr.replace('destDir', 'x')});
  const sourceDir = __dirname;
${copies}
}

install();
`;
}

// Per-platform postinstall scripts (npm install into node_modules triggers copy to project)
function createGeminiInstallScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

${NODE_MODULES_HELPERS}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
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

${NODE_MODULES_HELPERS}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  const codexDir = path.join(projectRoot, '.codex', 'plugins', 'gm-codex');
  const sourceDir = __dirname;
  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(codexDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(codexDir, 'hooks'));
  safeCopyDirectory(path.join(sourceDir, 'scripts'), path.join(codexDir, 'scripts'));
  safeCopyDirectory(path.join(sourceDir, 'skills'), path.join(codexDir, 'skills'));
  safeCopyDirectory(path.join(sourceDir, 'bin'), path.join(codexDir, 'bin'));
  safeCopyDirectory(path.join(sourceDir, '.agents'), path.join(codexDir, '.agents'));
  safeCopyDirectory(path.join(sourceDir, '.codex-plugin'), path.join(codexDir, '.codex-plugin'));
  safeCopyDirectory(path.join(sourceDir, 'assets'), path.join(codexDir, 'assets'));
  try { fs.copyFileSync(path.join(sourceDir, '.mcp.json'), path.join(codexDir, '.mcp.json')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, '.app.json'), path.join(codexDir, '.app.json')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'plugin.json'), path.join(codexDir, 'plugin.json')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'gm.json'), path.join(codexDir, 'gm.json')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'README.md'), path.join(codexDir, 'README.md')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'CLAUDE.md'), path.join(codexDir, 'CLAUDE.md')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'AGENTS.md'), path.join(codexDir, 'AGENTS.md')); } catch {}
}

install();
`;
}

function createOpenCodeInstallScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

${NODE_MODULES_HELPERS}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
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

${NODE_MODULES_HELPERS}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  const kiloDir = path.join(projectRoot, '.config', 'kilo', 'plugin');
  const sourceDir = __dirname;
  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(kiloDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(kiloDir, 'hooks'));
}

install();
`;
}

function createClaudeCodeInstallScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

${NODE_MODULES_HELPERS}

function safeCopyFile(src, dst) {
  try {
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    fs.writeFileSync(dst, fs.readFileSync(src, 'utf-8'), 'utf-8');
    return true;
  } catch (e) { return false; }
}

function safeCopyDirectoryFull(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach(entry => {
      const s = path.join(src, entry.name), d = path.join(dst, entry.name);
      if (entry.isDirectory()) safeCopyDirectoryFull(s, d);
      else safeCopyFile(s, d);
    });
    return true;
  } catch (e) { return false; }
}

function updateGitignore(projectRoot) {
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const entry = '.gm-stop-verified';
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    if (content.includes(entry)) return true;
    if (content && !content.endsWith('\\n')) content += '\\n';
    content += entry + '\\n';
    fs.writeFileSync(gitignorePath, content, 'utf-8');
    return true;
  } catch (e) { return false; }
}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  const claudeDir = path.join(projectRoot, '.claude');
  const sourceDir = __dirname.replace(/[\\/]scripts$/, '');
  safeCopyDirectoryFull(path.join(sourceDir, 'agents'), path.join(claudeDir, 'agents'));
  safeCopyDirectoryFull(path.join(sourceDir, 'hooks'), path.join(claudeDir, 'hooks'));
  safeCopyFile(path.join(sourceDir, '.mcp.json'), path.join(claudeDir, '.mcp.json'));
  updateGitignore(projectRoot);
}

install();
`;
}

// Global CLI installer scripts (run directly as cli.js / bun x gm-xx@latest)
function createCliInstaller({ pkg, label, destDir, filesToCopy, restartMsg, extraSetup = '' }) {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = ${destDir};

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading ${pkg}...' : 'Installing ${pkg}...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = ${JSON.stringify(filesToCopy)};

  ${COPY_RECURSIVE_FN}

  filesToCopy.forEach(([src, dst]) => copyRecursive(path.join(srcDir, src), path.join(destDir, dst)));
${extraSetup}
  const destPath = process.platform === 'win32' ? destDir.replace(/\\\\/g, '/') : destDir;
  console.log(\`✓ ${pkg} \${isUpgrade ? 'upgraded' : 'installed'} to \${destPath}\`);
  console.log('${restartMsg}');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
`;
}

function createGeminiInstallerScript() {
  return createCliInstaller({
    pkg: 'gm-gc',
    label: 'Gemini CLI',
    destDir: `path.join(homeDir, '.gemini', 'extensions', 'gm')`,
    filesToCopy: [
      ['agents', 'agents'], ['hooks', 'hooks'], ['.mcp.json', '.mcp.json'],
      ['gemini-extension.json', 'gemini-extension.json'], ['README.md', 'README.md'], ['GEMINI.md', 'GEMINI.md']
    ],
    restartMsg: 'Restart Gemini CLI to activate.'
  });
}

function createClaudeCodeCliScript() {
  const extraSetup = `
  const { execSync: exec } = require('child_process');
  const sep = process.platform === 'win32' ? ';' : ':';
  const sanitizedPath = (process.env.PATH || '').split(sep).filter(p => !/[\\\\/]node_modules[\\\\/]\\.bin$/.test(p.replace(/[\\\\/]+$/, ''))).join(sep);
  const run = (cmd) => { try { return exec(cmd, { stdio: 'inherit', env: { ...process.env, PATH: sanitizedPath, CLAUDECODE: '' } }); } catch (e) { console.warn('Warning:', e.message); } };

  const gmccHookFiles = ['post-tool-use-hook.js','pre-tool-use-hook.js','prompt-submit-hook.js','session-start-hook.js','stop-hook-git.js','stop-hook.js'];
  const gmccAgentFiles = ['gm.md'];
  const staleLocations = [
    ...gmccHookFiles.map(f => path.join(homeDir, '.claude', 'hooks', f)),
    ...gmccAgentFiles.map(f => path.join(homeDir, '.claude', 'agents', f)),
    ...gmccHookFiles.map(f => path.join(homeDir, '.claude', 'skills', f)),
    ...gmccAgentFiles.map(f => path.join(homeDir, '.claude', 'skills', f)),
    path.join(homeDir, '.claude', 'plugins', 'gm-cc'),
  ];
  staleLocations.forEach(p => {
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    } catch (e) {}
  });

  const pluginCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache', 'gm-cc');
  copyRecursive(srcDir, pluginCacheDir);

  run('claude plugin marketplace add AnEntrypoint/gm-cc');
  run('claude plugin install gm@gm-cc --scope user');
  ${AUTO_UPDATE_CC}
`;
  return createCliInstaller({
    pkg: 'gm-cc',
    label: 'Claude Code',
    destDir: `path.join(homeDir, '.claude')`,
    filesToCopy: [],
    extraSetup,
    restartMsg: 'Restart Claude Code to activate.'
  });
}

function createCodexCliScript() {
  return createCliInstaller({
    pkg: 'gm-codex',
    label: 'Codex',
    destDir: `path.join(homeDir, '.codex', 'plugins', 'gm-codex')`,
    filesToCopy: [
      ['agents', 'agents'], ['hooks', 'hooks'], ['scripts', 'scripts'], ['skills', 'skills'],
      ['bin', 'bin'],
      ['.agents', '.agents'], ['.codex-plugin', '.codex-plugin'],
      ['assets', 'assets'], ['.app.json', '.app.json'],
      ['.mcp.json', '.mcp.json'], ['plugin.json', 'plugin.json'], ['gm.json', 'gm.json'],
      ['README.md', 'README.md'], ['CLAUDE.md', 'CLAUDE.md'], ['AGENTS.md', 'AGENTS.md']
    ],
    restartMsg: 'Restart Codex to activate.'
  });
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
  fs.mkdirSync(path.join(ocConfigDir, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(ocConfigDir, 'lang'), { recursive: true });

  ${COPY_RECURSIVE_FN}

  fs.copyFileSync(path.join(srcDir, 'gm-oc.mjs'), path.join(ocConfigDir, 'plugins', 'gm-oc.mjs'));
  copyRecursive(path.join(srcDir, 'agents'), path.join(ocConfigDir, 'agents'));
  copyRecursive(path.join(srcDir, 'skills'), path.join(ocConfigDir, 'skills'));
  copyRecursive(path.join(srcDir, 'lang'), path.join(ocConfigDir, 'lang'));
  copyRecursive(path.join(srcDir, 'bin'), path.join(ocConfigDir, 'bin'));
  copyRecursive(path.join(srcDir, 'hooks'), path.join(ocConfigDir, 'hooks'));

  const ocJsonPath = path.join(ocConfigDir, 'opencode.json');
  let ocConfig = {};
  try {
    const raw = fs.readFileSync(ocJsonPath, 'utf-8');
    ocConfig = JSON.parse(raw);
    if (ocConfig['']) { delete ocConfig['']; }
  } catch (e) {}
  delete ocConfig.mcp;
  ocConfig['$schema'] = 'https://opencode.ai/config.json';
  ocConfig.default_agent = 'gm';
  const pluginMjsPath = path.join(ocConfigDir, 'plugins', 'gm-oc.mjs');
  if (!Array.isArray(ocConfig.plugin)) ocConfig.plugin = [];
  ocConfig.plugin = ocConfig.plugin.filter(p => !p.includes('gm-oc'));
  ocConfig.plugin.push(pluginMjsPath);
  fs.writeFileSync(ocJsonPath, JSON.stringify(ocConfig, null, 2) + '\\n');

  const oldDir = process.platform === 'win32'
    ? path.join(homeDir, 'AppData', 'Roaming', 'opencode', 'plugin') : null;
  if (oldDir && fs.existsSync(oldDir)) {
    try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch (e) {}
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
  fs.mkdirSync(path.join(kiloConfigDir, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(kiloConfigDir, 'lang'), { recursive: true });

  ${COPY_RECURSIVE_FN}

  fs.copyFileSync(path.join(srcDir, 'gm-kilo.mjs'), path.join(kiloConfigDir, 'plugins', 'gm-kilo.mjs'));
  copyRecursive(path.join(srcDir, 'agents'), path.join(kiloConfigDir, 'agents'));
  copyRecursive(path.join(srcDir, 'skills'), path.join(kiloConfigDir, 'skills'));
  copyRecursive(path.join(srcDir, 'lang'), path.join(kiloConfigDir, 'lang'));
  copyRecursive(path.join(srcDir, 'bin'), path.join(kiloConfigDir, 'bin'));
  copyRecursive(path.join(srcDir, 'hooks'), path.join(kiloConfigDir, 'hooks'));

  const kiloJsonPath = path.join(kiloConfigDir, 'kilocode.json');
  let kiloConfig = {};
  try {
    const raw = fs.readFileSync(kiloJsonPath, 'utf-8');
    kiloConfig = JSON.parse(raw);
    if (kiloConfig['']) { delete kiloConfig['']; }
  } catch (e) {}
  delete kiloConfig.mcp;
  kiloConfig['$schema'] = 'https://kilo.ai/config.json';
  kiloConfig.default_agent = 'gm';
  const kiloPluginPath = path.join(kiloConfigDir, 'plugins', 'gm-kilo.mjs');
  if (!Array.isArray(kiloConfig.plugin)) kiloConfig.plugin = [];
  kiloConfig.plugin = kiloConfig.plugin.filter(p => !p.includes('gm-kilo'));
  kiloConfig.plugin.push(kiloPluginPath);
  fs.writeFileSync(kiloJsonPath, JSON.stringify(kiloConfig, null, 2) + '\\n');

  const oldDir = process.platform === 'win32'
    ? path.join(homeDir, 'AppData', 'Roaming', 'kilo', 'plugin') : null;
  if (oldDir && fs.existsSync(oldDir)) {
    try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(\`✓ gm-kilo \${isUpgrade ? 'upgraded' : 'installed'} to \${kiloConfigDir}\`);
  console.log('Restart Kilo CLI to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
`;
}

function makePackageJson(fields) {
  return JSON.stringify(fields, null, 2);
}

function repoFields(pkg) {
  return {
    repository: { type: 'git', url: `https://github.com/AnEntrypoint/${pkg}.git` },
    homepage: `https://github.com/AnEntrypoint/${pkg}#readme`,
    bugs: { url: `https://github.com/AnEntrypoint/${pkg}/issues` }
  };
}

function pluginMjsSource(pluginFile) {
  const lines = [
    "import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';",
    "import { join, dirname, extname, basename } from 'path';",
    "import { fileURLToPath } from 'url';",
    "import { spawnSync } from 'child_process';",
    "import { tmpdir } from 'os';",
    "",
    "const __dirname = dirname(fileURLToPath(import.meta.url));",
    "const LANG_ALIASES = { js:'nodejs',javascript:'nodejs',ts:'typescript',node:'nodejs',py:'python',sh:'bash',shell:'bash',zsh:'bash' };",
    "const FORBIDDEN_TOOLS = new Set(['glob','Glob','grep','Grep','search_file_content','Find','find']);",
    "const FORBIDDEN_FILE_RE = [/\\.(test|spec)\\.(js|ts|jsx|tsx|mjs|cjs)$/, /^(jest|vitest|mocha|ava|jasmine|tap)\\.(config|setup)/, /\\.(snap|stub|mock|fixture)\\.(js|ts|json)$/];",
    "const FORBIDDEN_PATH_RE = ['/__tests__/','/test/','/tests/','/fixtures/','/test-data/',\"/__mocks__/\"];",
    "const DOC_BLOCK_RE = /\\.(md|txt)$/;",
    "",
    "function runPlugkit(args) {",
    "  const bin = join(__dirname, '..', 'bin', 'plugkit.js');",
    "  if (!existsSync(bin)) return '';",
    "  try {",
    "    const r = spawnSync('node', [bin, ...args], { encoding: 'utf-8', timeout: 15000, windowsHide: true });",
    "    return (r.stdout || '').trim() || (r.stderr || '').trim();",
    "  } catch(e) { return ''; }",
    "}",
    "",
    "function safePrintf(s) {",
    "  return \"printf '%s' '\" + String(s).replace(/\\\\\\\\/g,'\\\\\\\\\\\\\\\\').replace(/'/g,\"'\\\\\\\\''\")+\"'\";",
    "}",
    "",
    "function stripFooter(s) { return s ? s.replace(/\\n\\[Running tools\\][\\s\\S]*$/, '').trimEnd() : ''; }",
    "",
    "function tryLangPlugin(lang, code, cwd) {",
    "  const projectDir = cwd || process.cwd();",
    "  const candidates = [join(projectDir, 'lang', lang+'.js'), join(__dirname, '..', 'lang', lang+'.js')];",
    "  for (const langPluginFile of candidates) {",
    "    if (!existsSync(langPluginFile)) continue;",
    "    try {",
    "      const plugin = require(langPluginFile);",
    "      if (plugin && plugin.exec && plugin.exec.run) {",
    "        const result = plugin.exec.run(code, projectDir);",
    "        if (result && typeof result.then === 'function') continue;",
    "        return String(result === undefined ? '' : result);",
    "      }",
    "    } catch(e) {}",
    "  }",
    "  return null;",
    "}",
    "",
    "function runExecSync(rawLang, code, cwd) {",
    "  const lang = LANG_ALIASES[rawLang] || rawLang || 'nodejs';",
    "  const opts = { encoding: 'utf-8', timeout: 30000, windowsHide: true, ...(cwd && { cwd }) };",
    "  const out = (r) => { const o = (r.stdout||'').trimEnd(), e = stripFooter(r.stderr||'').trimEnd(); return o && e ? o+'\\n[stderr]\\n'+e : o||e||'(no output)'; };",
    "  if (lang === 'codesearch' || lang === 'search') return runPlugkit(['search', '--path', cwd || process.cwd(), code.trim()]);",
    "  if (lang === 'runner') return runPlugkit(['runner', code.trim()]);",
    "  if (lang === 'status') return runPlugkit(['status', code.trim()]);",
    "  if (lang === 'sleep') return runPlugkit(['sleep', code.trim()]);",
    "  if (lang === 'close') return runPlugkit(['close', code.trim()]);",
    "  if (lang === 'browser') return runPlugkit(['exec', '--lang', 'browser', '--code', code.trim(), '--cwd', cwd || process.cwd()]);",
    "  if (lang === 'cmd') return out(spawnSync('cmd',['/c',code],opts));",
    "  const pluginResult = tryLangPlugin(lang, code, cwd);",
    "  if (pluginResult !== null) return pluginResult;",
    "  if (lang === 'python') return out(spawnSync('python3',['-c',code],opts));",
    "  if (lang === 'bash' || lang === 'sh') {",
    "    const tmp = join(tmpdir(),'gm-exec-'+Date.now()+'.sh');",
    "    writeFileSync(tmp,code,'utf-8');",
    "    const r = spawnSync('bash',[tmp],opts);",
    "    try { unlinkSync(tmp); } catch(e) {}",
    "    return out(r);",
    "  }",
    "  const ext = lang === 'typescript' ? 'ts' : 'mjs';",
    "  const tmp = join(tmpdir(),'gm-exec-'+Date.now()+'.'+ext);",
    "  const src = lang === 'typescript' ? code : 'const __r=await(async()=>{\\n'+code+'\\n})();if(__r!==undefined){if(typeof __r===\"object\"){console.log(JSON.stringify(__r,null,2));}else{console.log(__r);}}';",
    "  writeFileSync(tmp,src,'utf-8');",
    "  const r = spawnSync('bun',['run',tmp],opts);",
    "  try { unlinkSync(tmp); } catch(e) {}",
    "  let result = out(r);",
    "  if (result) result = result.split(tmp).join('<script>');",
    "  return result;",
    "}",

    "",
    "const BANNED_BASH = ['grep','rg','find','glob','awk','sed','cat','head','tail'];",
    "function bashBannedTool(code) {",
    "  for (const t of BANNED_BASH) { if (new RegExp('(^|\\\\||;|&&|\\\\$\\\\()\\\\s*'+t+'(\\\\s|$)').test(code)) return t; }",
    "  return null;",
    "}",
    "",
    "let sessionStarted = false;",
    "",
    "export async function GmPlugin({ directory }) {",
    "  const agentMd = join(__dirname, '..', 'agents', 'gm.md');",
    "  const prdFile = join(directory, '.prd');",
    "  const injectedSessions = new Set();",
    "",
    "  return {",
    "    'experimental.chat.system.transform': async (input, output) => {",
    "      try {",
    "        const giPath = join(directory, '.gitignore');",
    "        const entry = '.gm-stop-verified';",
    "        try {",
    "          let content = existsSync(giPath) ? readFileSync(giPath,'utf-8') : '';",
    "          if (!content.split('\\n').some(l => l.trim() === entry)) {",
    "            const nc = (content.endsWith('\\n') || content === '') ? content + entry + '\\n' : content + '\\n' + entry + '\\n';",
    "            writeFileSync(giPath, nc, 'utf-8');",
    "          }",
    "        } catch(e) {}",
    "      } catch(e) {}",
    "      if (!sessionStarted) {",
    "        sessionStarted = true;",
    "        try { runPlugkit(['hook', 'session-start']); } catch(e) {}",
    "        try { runPlugkit(['bootstrap', directory]); } catch(e) {}",
    "      }",
    "      try { const rules = readFileSync(agentMd,'utf-8'); if (rules) output.system.unshift(rules); } catch(e) {}",
    "      try {",
    "        if (existsSync(prdFile)) {",
    "          const prd = readFileSync(prdFile,'utf-8').trim();",
    "          if (prd) output.system.push('\\nPENDING WORK (.prd):\\n'+prd);",
    "        }",
    "      } catch(e) {}",
    "    },",
    "",
    "    'experimental.chat.messages.transform': async (input, output) => {",
    "      const msgs = output.messages;",
    "      const lastUserIdx = msgs ? msgs.findLastIndex(m => m.info && m.info.role === 'user') : -1;",
    "      if (lastUserIdx === -1) return;",
    "      const msg = msgs[lastUserIdx];",
    "      const sessionID = msg.info && msg.info.sessionID;",
    "      if (sessionID && injectedSessions.has(sessionID)) return;",
    "      if (sessionID) injectedSessions.add(sessionID);",
    "      const textPart = msg.parts && msg.parts.find(p => p.type === 'text' && p.text && p.text.trim());",
    "      const prompt = textPart ? textPart.text.trim() : '';",
    "      const parts = [];",
    "      parts.push('Invoke the `gm` skill to begin. DO NOT use EnterPlanMode.');",
    "      const insight = runPlugkit(['codeinsight', directory]);",
    "      if (insight && !insight.startsWith('Error')) parts.push('=== codeinsight ===\\n'+insight);",
    "      if (prompt) {",
    "        const search = runPlugkit(['search', '--path', directory, prompt]);",
    "        if (search && !search.startsWith('No results')) parts.push('=== search ===\\n'+search);",
    "      }",
    "      const injection = '<system-reminder>\\n'+parts.join('\\n\\n')+'\\n</system-reminder>';",
    "      if (textPart) textPart.text = injection + '\\n' + textPart.text;",
    "      else if (msg.parts) msg.parts.unshift({ type: 'text', text: injection });",
    "    },",
    "",
    "    'tool.execute.before': async (input, output) => {",
    "      if (FORBIDDEN_TOOLS.has(input.tool)) {",
    "        throw new Error('Use the code-search skill for codebase exploration instead of '+input.tool+'. Describe what you need in plain language.');",
    "      }",
    "      if (input.tool === 'EnterPlanMode') {",
    "        throw new Error('Plan mode is disabled. Use the gm skill (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE state machine) instead.');",
    "      }",
    "      if (input.tool === 'Task' && input.args?.subagent_type === 'Explore') {",
    "        throw new Error('The Explore agent is blocked. Use exec:codesearch in the Bash tool instead.\\n\\nexec:codesearch\\n<natural language description of what to find>');",
    "      }",
    "      if (input.tool === 'Skill') {",
    "        const skill = ((input.args && input.args.skill) || '').toLowerCase().replace(/^gm:/,'');",
    "        if (skill === 'explore' || skill === 'search') {",
    "          throw new Error('The search/explore skill is blocked. Use exec:codesearch instead.\\n\\nexec:codesearch\\n<natural language description>');",
    "        }",
    "      }",
    "      if (input.tool === 'write' || input.tool === 'Write' || input.tool === 'edit' || input.tool === 'Edit') {",
    "        const fp = (output.args && output.args.file_path) || (input.args && input.args.file_path) || '';",
    "        const base = basename(fp).toLowerCase();",
    "        const ext = extname(fp);",
    "        const blocked = FORBIDDEN_FILE_RE.some(re => re.test(base)) || FORBIDDEN_PATH_RE.some(p => fp.includes(p))",
    "          || (DOC_BLOCK_RE.test(ext) && !base.startsWith('claude') && !base.startsWith('agents') && !base.startsWith('readme') && !fp.includes('/skills/'));",
    "        if (blocked) {",
    "          throw new Error('Cannot create test/doc files. Use .prd for task notes, AGENTS.md for permanent notes.');",
    "        }",
    "      }",
    "      if (input.tool !== 'bash' && input.tool !== 'Bash') return;",
    "      const cmd = (output.args && output.args.command) || '';",
    "      if (!cmd) return;",
    "      if (/^\\s*git(?:\\s|$)/.test(cmd)) return;",
    "      const m = cmd.match(/^exec(?::(\\S+))?\\n([\\s\\S]+)$/);",
     "      if (!m) {",
     "        output.args.command = \"echo 'Bash tool can only be used with exec syntax:\\n\\nexec[:lang]\\n<command>\\n\\nExamples:\\nexec\\nls -la\\n\\nexec:nodejs\\nconsole.log(\\\"hello\\\")' 1>&2 && false\";",
     "        return;",
     "      }",
     "      const rawLang = (m[1]||'').toLowerCase();",
     "      if (rawLang === 'bash' || rawLang === 'sh' || rawLang === '') {",
     "        const banned = bashBannedTool(m[2]);",
     "        if (banned) throw new Error('`'+banned+'` is blocked in exec:bash. Use exec:codesearch instead.');",
     "      }",
     "      const result = runExecSync(m[1]||'', m[2], output.args.workdir || directory);",
     "      output.args = { ...output.args, command: safePrintf('exec:'+(m[1]||'nodejs')+' output:\\n\\n'+result) };",
    "    },",
    "    'message.updated': async (input, output) => {",
    "      try {",
    "        const role = input && input.message && input.message.info && input.message.info.role;",
    "        if (role !== 'user') return;",
    "        runPlugkit(['hook', 'prompt-submit']);",
    "      } catch(e) {}",
    "    },",
    "    'session.closing': async (input, output) => {",
    "      try { runPlugkit(['hook', 'stop']); } catch(e) {}",
    "      try { runPlugkit(['hook', 'stop-git']); } catch(e) {}",
    "    },",
    "  };",
    "}",
  ];
  return lines.join('\n') + '\n';
}

function createCcPromptSubmitHook() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const gmDir = path.join(process.cwd(), '.gm');
try {
  if (!fs.existsSync(gmDir)) fs.mkdirSync(gmDir, { recursive: true });
  fs.writeFileSync(path.join(gmDir, 'needs-gm'), '1', 'utf8');
} catch (_) {}
const response = {
  systemMessage: 'BLOCKING REQUIREMENT — READ THIS FIRST: Your VERY FIRST action on EVERY user message MUST be to invoke the Skill tool with skill: "gm". Do NOT read files, do NOT search, do NOT answer, do NOT plan, do NOT use any other tool before invoking skill: "gm". This is non-negotiable. If you respond without invoking gm first, you are violating a hard constraint.\\n\\nUse gm for ALL work. Spawn subagents (Agent tool) for every independent unit of work — parallel subagents are always preferred over sequential execution. Never do work yourself that a subagent could do in parallel.'
};
process.stdout.write(JSON.stringify(response));
`;
}

function createCcPreToolUseHook() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) {}
if (!raw.trim()) raw = process.env.CLAUDE_HOOK_INPUT || '{}';
const input = JSON.parse(raw);
const toolName = input.tool_name || input.tool_use?.name || '';
const toolInput = input.tool_input || input.tool_use?.input || {};
const skillName = toolInput.skill || toolInput.name || '';
const gmDir = path.join(process.cwd(), '.gm');
const needsGmPath = path.join(gmDir, 'needs-gm');
const lastskillPath = path.join(gmDir, 'lastskill');
const isSkillTool = toolName === 'Skill' || toolName === 'skill';
if (isSkillTool && skillName) {
  try {
    if (!fs.existsSync(gmDir)) fs.mkdirSync(gmDir, { recursive: true });
    fs.writeFileSync(lastskillPath, skillName, 'utf8');
    if (skillName === 'gm' || skillName === 'gm:gm') {
      try { fs.unlinkSync(needsGmPath); } catch (_) {}
    }
  } catch (_) {}
  process.exit(0);
}
if (fs.existsSync(needsGmPath)) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'HARD CONSTRAINT: invoke the Skill tool with skill: "gm" before any other tool. The gm skill must be the first action after every user message.' }));
  process.exit(0);
}
const lastSkill = (() => { try { return fs.readFileSync(lastskillPath, 'utf8').trim(); } catch (_) { return ''; } })();
const isFileEdit = ['Write', 'Edit', 'NotebookEdit'].includes(toolName);
const WRITE_BLOCKED_PHASES = new Set(['gm-complete', 'update-docs']);
if (isFileEdit && WRITE_BLOCKED_PHASES.has(lastSkill)) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'File edits are not permitted in ' + lastSkill + ' phase. Regress to gm-execute if changes are needed, or invoke gm-emit to re-emit.' }));
  process.exit(0);
}
`;
}

const cc = factory('cc', 'Claude Code', 'CLAUDE.md', 'CLAUDE.md', {
  formatConfigJson(config) {
    return makePackageJson({ ...config, author: { name: config.author, url: 'https://github.com/AnEntrypoint' } });
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return makePackageJson({
      name: 'gm-cc', version: pluginSpec.version, description: pluginSpec.description,
      author: pluginSpec.author, license: pluginSpec.license,
      ...repoFields('gm-cc'), engines: pluginSpec.engines, publishConfig: pluginSpec.publishConfig,
      bin: { 'gm-cc': './cli.js', 'gm-install': './install.js' },
      files: ['agents/', 'bin/', 'hooks/', 'scripts/', 'skills/', '.github/', '.mcp.json', '.claude-plugin/', 'plugin.json', 'gm.json', 'README.md', 'LICENSE', '.gitignore', '.editorconfig', 'CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md'],
      keywords: ['claude-code', 'agent', 'state-machine', 'mcp', 'automation', 'gm'],
      peerDependencies: { '@anthropic-ai/claude-code': '*' },
      peerDependenciesMeta: { '@anthropic-ai/claude-code': { optional: true } },
      scripts: pluginSpec.scripts, ...extraFields
    });
  },
  getPackageJsonFields() {
    return {
      files: ['agents/', 'bin/', 'hooks/', 'scripts/', 'skills/', '.github/', '.mcp.json', '.claude-plugin/', 'plugin.json', 'cli.js', 'install.js', 'README.md', 'LICENSE', '.gitignore', '.editorconfig', 'CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md'],
      keywords: ['claude-code', 'agent', 'state-machine', 'mcp', 'automation', 'gm'],
      peerDependencies: { '@anthropic-ai/claude-code': '*' },
      peerDependenciesMeta: { '@anthropic-ai/claude-code': { optional: true } }
    };
  },
  getAdditionalFiles(spec) {
    return {
      'plugin.json': TemplateBuilder.generatePluginJson(spec),
      '.claude-plugin/marketplace.json': TemplateBuilder.generateMarketplaceJson(spec, 'gm-cc'),
      'cli.js': createClaudeCodeCliScript(),
      'install.js': createClaudeCodeInstallScript(),
      'hooks/prompt-submit-hook.js': createCcPromptSubmitHook(),
      'hooks/pre-tool-use-hook.js': createCcPreToolUseHook(),
    };
  },
  buildHooksMap() {
    const envVar = 'CLAUDE_PLUGIN_ROOT';
    const plugkit = `node \${${envVar}}/bin/plugkit.js hook`;
    const hook = (h, t) => ({ type: 'command', command: `${plugkit} ${h}`, timeout: t });
    const jsHook = (f, t) => ({ type: 'command', command: `node \${${envVar}}/hooks/${f}`, timeout: t });
    const wrap = (cmds) => [{ matcher: '*', hooks: Array.isArray(cmds) ? cmds : [cmds] }];
    return {
      PreToolUse: wrap([hook('pre-tool-use', 3600), jsHook('pre-tool-use-hook.js', 2000)]),
      SessionStart: wrap(hook('session-start', 180000)),
      UserPromptSubmit: wrap([hook('prompt-submit', 60000), jsHook('prompt-submit-hook.js', 3000)]),
      PreCompact: wrap(hook('pre-compact', 30000)),
      Stop: wrap([hook('stop', 15000), hook('stop-git', 210000)]),
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

function createGcPreToolUseHook() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const writeTools = ['write_file', 'edit_file'];
const forbiddenTools = ['find', 'Find', 'Glob', 'Grep', 'glob', 'search_file_content'];
const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;
    if (!tool_name) return { allow: true };
    if (forbiddenTools.includes(tool_name)) {
      return { deny: true, reason: 'Use the code-search skill for codebase exploration instead of Grep/Glob/find. Describe what you need in plain language.' };
    }
    if (writeTools.includes(tool_name)) {
      const file_path = tool_input?.file_path || '';
      const ext = path.extname(file_path);
      const inSkillsDir = file_path.includes('/skills/');
      const base = path.basename(file_path).toLowerCase();
      if ((ext === '.md' || ext === '.txt' || base.startsWith('features_list')) &&
          !base.startsWith('claude') && !base.startsWith('agents') && !base.startsWith('readme') && !inSkillsDir) {
        return { deny: true, reason: 'Cannot create documentation files. Only AGENTS.md, CLAUDE.md and readme.md are maintained.' };
      }
      if (/\\.(test|spec)\\.(js|ts|jsx|tsx|mjs|cjs)$/.test(base) ||
          /^(jest|vitest|mocha|ava|jasmine|tap)\\.(config|setup)/.test(base) ||
          /\\.(snap|stub|mock|fixture)\\.(js|ts|json)$/.test(base) ||
          file_path.includes('/__tests__/') || file_path.includes('/test/') ||
          file_path.includes('/tests/') || file_path.includes('/fixtures/') ||
          file_path.includes('/test-data/') || file_path.includes('/__mocks__/')) {
        return { deny: true, reason: 'Test files forbidden on disk. Use real services for all testing.' };
      }
    }
    if (tool_name === 'run_shell_command') {
      const command = (tool_input?.command || '').trim();
      const isExec = command.startsWith('exec:');
      const isGit = /^(git |gh )/.test(command);
      if (!isExec && !isGit) {
        return { deny: true, reason: 'run_shell_command requires exec:<lang> format with a NEWLINE between the lang and code. Example: exec:bash\\nnpm --version\\n(newline after exec:bash, not a space). Allowed: exec:nodejs, exec:bash, exec:python, exec:typescript, git, gh.' };
      }
      if (isExec) {
        const newline = command.indexOf('\\n');
        if (newline === -1) return { allow: true };
        const rawLang = command.substring(5, newline);
        const code = command.substring(newline + 1);
        const { spawnSync } = require('child_process');
        const pluginRoot = path.join(__dirname, '..');
        const plugkitJs = path.join(pluginRoot, 'bin', 'plugkit.js');
        let result;
        if (rawLang === 'browser') {
          result = spawnSync('node', [plugkitJs, 'exec', '--lang', 'browser', code], { encoding: 'utf-8', timeout: 300000, windowsHide: true });
        } else if (rawLang === 'codesearch') {
          const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
          result = spawnSync('node', [plugkitJs, 'search', '--path', projectDir, code], { encoding: 'utf-8', timeout: 60000, windowsHide: true });
        } else {
          result = spawnSync('node', [plugkitJs, 'exec', '--lang', rawLang, code], { encoding: 'utf-8', timeout: 120000, windowsHide: true });
        }
        const output = (result.stdout || '') + (result.stderr || '');
        return { deny: true, reason: 'exec:' + rawLang + ' output:\\n\\n' + output };
      }
    }
    return { allow: true };
  } catch (e) {
    return { allow: true };
  }
};
try {
  const result = run();
  if (result.deny) {
    console.log(JSON.stringify({ decision: 'deny', reason: result.reason }));
    process.exit(0);
  }
  process.exit(0);
} catch (e) {
  process.exit(0);
}
`;
}

function createGcPromptSubmitHook() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const pluginRoot = process.env.GEMINI_PROJECT_DIR ? path.join(__dirname, '..') : (process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..'));
const plugkitBin = path.join(pluginRoot, 'bin', 'plugkit.js');
const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
const readStdinPrompt = () => {
  try { return JSON.parse(fs.readFileSync(0, 'utf-8')).prompt || ''; } catch (e) { return ''; }
};
const runCodeinsight = () => {
  if (!projectDir || !fs.existsSync(projectDir)) return '';
  try {
    const r = spawnSync('node', [plugkitBin, 'codeinsight', projectDir], { encoding: 'utf-8', stdio: 'pipe', windowsHide: true, cwd: projectDir, timeout: 10000 });
    const out = (r.stdout || '').trim();
    if (!out || out.startsWith('Error') || r.status !== 0) return '';
    return out;
  } catch (e) { return ''; }
};
const runSearch = (query) => {
  if (!query || !projectDir) return '';
  try {
    const r = spawnSync('node', [plugkitBin, 'search', '--path', projectDir, query.substring(0, 200)], { encoding: 'utf-8', stdio: 'pipe', windowsHide: true, cwd: projectDir, timeout: 5000 });
    const out = (r.stdout || '').trim();
    if (!out || r.status !== 0) return '';
    return out;
  } catch (e) { return ''; }
};
try {
  const prompt = readStdinPrompt();
  const insight = runCodeinsight();
  const search = runSearch(prompt);
  const sections = ['Invoke the gm skill to begin. DO NOT use EnterPlanMode.'];
  if (insight) sections.push('=== codeinsight ===\\n' + insight);
  if (search) sections.push('=== search ===\\n' + search);
  const injection = '<system-reminder>\\n' + sections.join('\\n\\n') + '\\n</system-reminder>';
  console.log(JSON.stringify({ decision: 'deny', reason: injection }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ decision: 'deny', reason: '<system-reminder>\\nInvoke the gm skill to begin. DO NOT use EnterPlanMode.\\n</system-reminder>' }, null, 2));
}
`;
}

function createGcStopHook() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const prdFile = path.resolve(process.cwd(), '.gm', 'prd.yml');
let aborted = false;
process.on('SIGTERM', () => { aborted = true; });
process.on('SIGINT', () => { aborted = true; });
try {
  if (!aborted && fs.existsSync(prdFile)) {
    const content = fs.readFileSync(prdFile, 'utf-8').trim();
    if (content.length > 0) {
      console.log(JSON.stringify({ decision: 'block', reason: 'Work items remain in .gm/prd.yml. Remove completed items as they finish. Current items:\\n\\n' + content }, null, 2));
      process.exit(2);
    }
  }
  console.log(JSON.stringify({ decision: 'approve' }, null, 2));
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({ decision: 'approve' }, null, 2));
  process.exit(0);
}
`;
}

function createGcStopHookGit() {
  return `#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
const counterPath = path.join(require('os').tmpdir(), 'gm-gc-git-' + crypto.createHash('md5').update(projectDir).digest('hex') + '.json');
const readCounter = () => { try { return JSON.parse(fs.readFileSync(counterPath, 'utf-8')); } catch (e) { return { count: 0, lastHash: null }; } };
const writeCounter = (d) => { try { fs.writeFileSync(counterPath, JSON.stringify(d)); } catch (e) {} };
const gitHash = () => { try { return execSync('git rev-parse HEAD', { cwd: projectDir, stdio: 'pipe', encoding: 'utf-8' }).trim(); } catch (e) { return null; } };
const getStatus = () => {
  try { execSync('git rev-parse --git-dir', { cwd: projectDir, stdio: 'pipe' }); } catch (e) { return null; }
  const status = execSync('git status --porcelain', { cwd: projectDir, stdio: 'pipe', encoding: 'utf-8' }).trim();
  let unpushed = 0;
  try { unpushed = parseInt(execSync('git rev-list --count @{u}..HEAD', { cwd: projectDir, stdio: 'pipe', encoding: 'utf-8' }).trim()) || 0; } catch (e) { unpushed = -1; }
  return { isDirty: status.length > 0, unpushed };
};
try {
  const st = getStatus();
  if (!st) { console.log(JSON.stringify({ decision: 'approve' })); process.exit(0); }
  const hash = gitHash();
  const counter = readCounter();
  if (counter.lastHash && hash && counter.lastHash !== hash) { counter.count = 0; counter.lastHash = hash; writeCounter(counter); }
  const issues = [];
  if (st.isDirty) issues.push('uncommitted changes');
  if (st.unpushed > 0) issues.push(st.unpushed + ' commit(s) not pushed');
  if (st.unpushed === -1) issues.push('push status unknown');
  if (issues.length > 0) {
    counter.count = (counter.count || 0) + 1;
    counter.lastHash = hash;
    writeCounter(counter);
    if (counter.count === 1) {
      console.log(JSON.stringify({ decision: 'block', reason: 'Git: ' + issues.join(', ') + '. Commit and push before ending session.' }, null, 2));
      process.exit(2);
    }
    console.log(JSON.stringify({ decision: 'approve', reason: 'Git warning #' + counter.count + ': ' + issues.join(', ') }, null, 2));
    process.exit(0);
  }
  if (counter.count > 0) { counter.count = 0; writeCounter(counter); }
  console.log(JSON.stringify({ decision: 'approve' }, null, 2));
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({ decision: 'approve' }, null, 2));
  process.exit(0);
}
`;
}

function createGcSessionStartHook() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pluginRoot = path.join(__dirname, '..');
const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
try {
  const parts = [];
  try { parts.push(fs.readFileSync(path.join(pluginRoot, 'agents/gm.md'), 'utf-8')); } catch (e) {}
  if (projectDir && fs.existsSync(projectDir)) {
    try {
      const out = execSync('plugkit codeinsight ' + JSON.stringify(projectDir), { encoding: 'utf-8', stdio: 'pipe', cwd: projectDir, timeout: 55000 });
      if (out && !out.startsWith('Error')) parts.push('=== This is your initial insight of the repository, look at every possible aspect of this for initial opinionation and to offset the need for code exploration ===\\n' + out);
    } catch (e) {}
  }
  parts.push('Use gm as a philosophy to coordinate all plans and the gm subagent to create and execute all plans');
  console.log(JSON.stringify({ systemMessage: parts.join('\\n\\n') }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ systemMessage: 'use gm agent' }, null, 2));
}
`;
}

const gc = factory('gc', 'Gemini CLI', 'gemini-extension.json', 'GEMINI.md', {
  loadSkillsFromSource() { return {}; },
  formatConfigJson(config) {
    return makePackageJson({ ...config, contextFileName: this.contextFile });
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return makePackageJson({
      name: 'gm-gc', version: pluginSpec.version, description: pluginSpec.description,
      author: pluginSpec.author, license: pluginSpec.license,
      ...repoFields('gm-gc'), engines: pluginSpec.engines, publishConfig: pluginSpec.publishConfig,
      bin: { 'gm-gc': './cli.js', 'gm-gc-install': './install.js' },
      files: ['agents/', 'hooks/', '.github/', 'README.md', 'GEMINI.md', '.mcp.json', 'gemini-extension.json', 'cli.js', 'install.js'],
      ...(pluginSpec.scripts && { scripts: pluginSpec.scripts }), ...extraFields
    });
  },
  getPackageJsonFields() {
    return {
      bin: { 'gm-gc': './cli.js', 'gm-gc-install': './install.js' },
      files: ['agents/', 'hooks/', '.github/', 'README.md', 'GEMINI.md', '.mcp.json', 'gemini-extension.json', 'cli.js']
    };
  },
  getAdditionalFiles(spec) {
    return {
      'cli.js': createGeminiInstallerScript(),
      'install.js': createGeminiInstallScript(),
      'hooks/pre-tool-use-hook.js': createGcPreToolUseHook(),
      'hooks/prompt-submit-hook.js': createGcPromptSubmitHook(),
      'hooks/stop-hook.js': createGcStopHook(),
      'hooks/stop-hook-git.js': createGcStopHookGit(),
      'hooks/session-start-hook.js': createGcSessionStartHook(),
    };
  },
  buildHooksMap() {
    return {
      BeforeTool: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ${extensionPath}/hooks/pre-tool-use-hook.js', timeout: 3600 }] }],
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ${extensionPath}/hooks/session-start-hook.js', timeout: 180000 }] }],
      BeforeAgent: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ${extensionPath}/hooks/prompt-submit-hook.js', timeout: 60000 }] }],
      SessionEnd: [{ matcher: '*', hooks: [
        { type: 'command', command: 'node ${extensionPath}/hooks/stop-hook.js', timeout: 300000 },
        { type: 'command', command: 'node ${extensionPath}/hooks/stop-hook-git.js', timeout: 60000 }
      ] }]
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for Gemini CLI\n\n## Installation\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/gm-gc ~/.gemini/extensions/${spec.name}\n\`\`\`\n\n**Windows PowerShell:**\n\`\`\`powershell\ngit clone https://github.com/AnEntrypoint/gm-gc \"\\$env:APPDATA\\gemini\\extensions\\${spec.name}\"\n\`\`\`\n\n## Automatic Path Resolution\n\nHooks automatically use \`\${extensionPath}\` for path resolution. No manual environment variable setup required. The extension is fully portable.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe extension activates automatically on session start.\n`;
  }
});

const codex = factory('codex', 'Codex', 'plugin.json', 'CLAUDE.md', {
  formatConfigJson(config) {
    return makePackageJson({ ...config, author: { name: config.author, url: 'https://github.com/AnEntrypoint' }, hooks: './hooks/hooks.json', skills: './skills', mcpServers: {} });
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return makePackageJson({
      name: 'gm-codex', version: pluginSpec.version, description: pluginSpec.description,
      author: pluginSpec.author, license: pluginSpec.license, main: 'plugin.json',
      bin: { 'gm-codex': './cli.js', 'gm-codex-install': './install.js' },
      ...repoFields('gm-codex'), engines: pluginSpec.engines, publishConfig: pluginSpec.publishConfig,
      files: ['hooks/', 'agents/', 'bin/', 'scripts/', 'skills/', 'assets/', '.github/', '.agents/', '.codex-plugin/', 'README.md', 'CLAUDE.md', 'AGENTS.md', '.mcp.json', '.app.json', 'plugin.json', 'gm.json', 'cli.js', 'install.js'],
      keywords: ['codex', 'claude-code', 'wfgy', 'mcp', 'automation', 'gm'],
      ...(pluginSpec.scripts && { scripts: pluginSpec.scripts }), ...extraFields
    });
  },
  getPackageJsonMain() { return 'plugin.json'; },
  getPackageJsonFields() {
    return {
      main: 'plugin.json',
      bin: { 'gm-codex': './cli.js', 'gm-codex-install': './install.js' },
      files: ['hooks/', 'agents/', 'bin/', 'scripts/', 'skills/', 'assets/', '.github/', '.agents/', '.codex-plugin/', 'README.md', 'CLAUDE.md', 'AGENTS.md', '.mcp.json', '.app.json', 'plugin.json', 'gm.json', 'cli.js', 'install.js'],
      keywords: ['codex', 'claude-code', 'wfgy', 'mcp', 'automation', 'gm']
    };
  },
  generateReadme(spec) {
    const repoName = 'gm-codex';
    return `# ${repoName} for Codex

## Installation

### One-liner (recommended)

\`\`\`bash
bun x ${repoName}@latest
\`\`\`

This installs or upgrades the plugin into your user Codex plugins directory and keeps the package layout consistent across platforms.

### Repository Installation (Project-Specific)

\`\`\`bash
cd /path/to/your/project
npm install ${repoName}
npx ${repoName}-install
\`\`\`

The installer copies plugin assets into \`.codex/plugins/gm-codex\` in your project and is useful for local customization.

### Manual Installation

**Windows and Unix:**
\`\`\`bash
git clone https://github.com/AnEntrypoint/${repoName} ~/.codex/plugins/gm-codex
\`\`\`

**Windows PowerShell:**
\`\`\`powershell
git clone https://github.com/AnEntrypoint/${repoName} "\\$env:APPDATA\\codex\\plugins\\gm-codex"
\`\`\`

## Installed Layout

After install, the Codex plugin directory contains:

\`\`\`
plugins/gm-codex/
├── .codex-plugin/plugin.json
├── .agents/plugins/marketplace.json
├── agents/
├── hooks/
├── scripts/
├── skills/
├── .mcp.json
├── gm.json
└── plugin.json
\`\`\`

## Runtime Behavior

- Hooks call \`bin/plugkit\` through \`\${CODEX_PLUGIN_ROOT}\`.
- \`plugkit\` binaries are bundled in \`bin/\` for every supported platform; the plugin ships ready-to-run.
- \`plugkit\` uses:
  - \`rs-exec\` for execution/runtime process management
  - \`rs-codeinsight\` for AST/project analysis
  - \`rs-search\` for search/MCP search behavior

## Environment

- \`CODEX_PLUGIN_ROOT\`: plugin root used by hooks
- \`CODEX_PROJECT_DIR\`: project root for hook/runtime operations

## Features

- Stateful agent policy via \`agents/gm.md\`
- Hook enforcement for session lifecycle
- Rust-backed execution and background task control
- Rust-backed code insight and search integrations
- Generated Codex plugin metadata and marketplace manifests

## Update Procedures

### User-wide install

\`\`\`bash
bun x ${repoName}@latest
\`\`\`

### Project-level install

\`\`\`bash
npm update ${repoName}
npx ${repoName}-install
\`\`\`

## Troubleshooting

### Hooks run but \`plugkit\` is missing

- Reinstall the plugin; \`plugkit\` binaries are shipped in \`bin/\` via CI and should not need to be downloaded.

### Hook path issues

- Verify \`CODEX_PLUGIN_ROOT\` points to the installed plugin root.
- Confirm \`hooks/hooks.json\` commands resolve to \`\${CODEX_PLUGIN_ROOT}/bin/plugkit\`.

### Plugin loaded but behavior is incomplete

- Check \`skills/\`, \`scripts/\`, and \`agents/\` were copied by installer.
- Re-run installer and restart Codex.

## License

MIT
`;
  },
  getAdditionalFiles(spec) {
    return {
      'cli.js': createCodexCliScript(),
      'install.js': createCodexInstallScript(),
      '.app.json': JSON.stringify({}, null, 2),
      'assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#3B82F6"/><path d="M16 33h32v6H16zM16 22h32v6H16zM16 44h20v6H16z" fill="#fff"/></svg>\n',
      'assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#1E3A8A"/><path d="M28 50h72v12H28zM28 70h72v12H28z" fill="#93C5FD"/><circle cx="40" cy="34" r="8" fill="#93C5FD"/></svg>\n',
      '.codex-plugin/plugin.json': TemplateBuilder.generateCodexPluginManifest(spec),
      '.agents/plugins/marketplace.json': TemplateBuilder.generateCodexMarketplaceJson('gm-codex')
    };
  }
});

const oc = factory('oc', 'OpenCode', 'opencode.json', 'GM.md', {
  loadSkillsFromSource(sourceDir) {
    return TemplateBuilder.loadSkillsFromSource(sourceDir, 'skills');
  },
  loadLangFromSource(sourceDir) {
    return TemplateBuilder.loadLangFromSource(sourceDir, 'lang');
  },
  getPackageJsonFields() {
    return {
      main: 'gm.js',
      bin: { 'gm-oc': './cli.js', 'gm-oc-install': './install.js' },
      files: ['agents/', 'hooks/', 'scripts/', 'skills/', 'lang/', 'gm.js', 'gm-oc.mjs', 'index.js', 'opencode.json', '.github/', 'README.md', 'cli.js', 'install.js', 'LICENSE', 'CONTRIBUTING.md', '.gitignore', '.editorconfig'],
      keywords: ['opencode', 'opencode-plugin', 'automation', 'gm'],
      dependencies: {}
    };
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return makePackageJson({
      name: 'gm-oc', version: pluginSpec.version, description: pluginSpec.description,
      author: pluginSpec.author, license: pluginSpec.license, main: 'gm-oc.mjs',
      bin: { 'gm-oc': './cli.js', 'gm-oc-install': './install.js' },
      keywords: ['opencode', 'opencode-plugin', 'automation', 'gm'],
      ...repoFields('gm-oc'), engines: pluginSpec.engines, publishConfig: pluginSpec.publishConfig,
      dependencies: {},
      scripts: { postinstall: 'node scripts/postinstall-oc.js' },
      files: ['agents/', 'hooks/', 'scripts/', 'skills/', 'lang/', 'gm.js', 'gm-oc.mjs', 'index.js', 'opencode.json', '.github/', 'README.md', 'cli.js', 'install.js', 'LICENSE', 'CONTRIBUTING.md', '.gitignore', '.editorconfig'],
      ...(pluginSpec.scripts && { scripts: pluginSpec.scripts }), ...extraFields
    });
  },
  formatConfigJson() {
    return makePackageJson({
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'gm',
      agent: {
        gm: {
          mode: 'primary',
          description: 'GM state machine agent — PLAN→EXECUTE→EMIT→VERIFY→COMPLETE',
          prompt: '{file:./agents/gm.md}'
        }
      }
    });
  },
  buildHooksMap() {
    const hooks = {};
    hooks['message.updated'] = [{ matcher: '*', hooks: [{ type: 'command', command: 'node ${OC_PLUGIN_ROOT}/bin/plugkit.js hook prompt-submit', timeout: 60000 }] }];
    hooks['session.closing'] = [{ matcher: '*', hooks: [
      { type: 'command', command: 'node ${OC_PLUGIN_ROOT}/bin/plugkit.js hook stop', timeout: 300000 },
      { type: 'command', command: 'node ${OC_PLUGIN_ROOT}/bin/plugkit.js hook stop-git', timeout: 60000 }
    ] }];
    return hooks;
  },
  getAdditionalFiles(spec) {
    return {
      'index.js': `module.exports = { GmPlugin: require('./gm-oc.mjs').GmPlugin };\n`,
      'gm.js': `module.exports = require('./gm-oc.mjs');\n`,
      'gm-oc.mjs': pluginMjsSource('gm-oc'),
      'cli.js': createOpenCodeInstallerScript(),
      'install.js': createOpenCodeInstallScript(),
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for OpenCode\n\n## Installation\n\n### One-liner (recommended)\n\nInstall directly from npm using bun x:\n\n\`\`\`bash\nbun x gm-oc@latest\n\`\`\`\n\nThis command will automatically install gm-oc to the correct location for your platform and restart OpenCode to activate.\n\n### Manual installation\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/gm-oc ~/.config/opencode/plugin && cd ~/.config/opencode/plugin && bun install\n\`\`\`\n\n**Windows PowerShell:**\n\`\`\`powershell\ngit clone https://github.com/AnEntrypoint/gm-oc \"\\$env:APPDATA\\opencode\\plugin\" && cd \"\\$env:APPDATA\\opencode\\plugin\" && bun install\n\`\`\`\n\n### Project-level\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/gm-oc .opencode/plugins && cd .opencode/plugins && bun install\n\`\`\`\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Git enforcement on session idle\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  }
});

const kilo = factory('kilo', 'Kilo CLI', 'kilocode.json', 'KILO.md', {
  loadSkillsFromSource(sourceDir) {
    return TemplateBuilder.loadSkillsFromSource(sourceDir, 'skills');
  },
  loadLangFromSource(sourceDir) {
    return TemplateBuilder.loadLangFromSource(sourceDir, 'lang');
  },
  getPackageJsonFields() {
    return {
      main: 'gm.js',
      bin: { 'gm-kilo': './cli.js', 'gm-kilo-install': './install.js' },
      files: ['agents/', 'bin/', 'hooks/', 'scripts/', 'skills/', 'lang/', 'gm.js', 'gm-kilo.mjs', 'index.js', 'kilocode.json', '.github/', 'README.md', 'cli.js', 'install.js', 'LICENSE', 'CONTRIBUTING.md', '.gitignore', '.editorconfig'],
      keywords: ['kilo', 'kilo-cli', 'automation', 'gm'],
      dependencies: {}
    };
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return makePackageJson({
      name: 'gm-kilo', version: pluginSpec.version, description: pluginSpec.description,
      author: pluginSpec.author, license: pluginSpec.license, main: 'gm-kilo.mjs',
      bin: { 'gm-kilo': './cli.js', 'gm-kilo-install': './install.js' },
      keywords: ['kilo', 'kilo-cli', 'mcp', 'automation', 'gm'],
      ...repoFields('gm-kilo'), engines: pluginSpec.engines, publishConfig: pluginSpec.publishConfig,
      dependencies: {},
      scripts: { postinstall: 'node scripts/postinstall-kilo.js' },
      files: ['agents/', 'bin/', 'hooks/', 'scripts/', 'skills/', 'lang/', 'gm.js', 'gm-kilo.mjs', 'index.js', 'kilocode.json', '.github/', 'README.md', 'cli.js', 'install.js', 'LICENSE', 'CONTRIBUTING.md', '.gitignore', '.editorconfig'],
      ...extraFields
    });
  },
  formatConfigJson() {
    return makePackageJson({
      $schema: 'https://kilo.ai/config.json',
      default_agent: 'gm',
      agent: {
        gm: {
          mode: 'primary',
          description: 'GM state machine agent — PLAN→EXECUTE→EMIT→VERIFY→COMPLETE',
          prompt: '{file:./agents/gm.md}'
        }
      }
    });
  },
  buildHooksMap() {
    const hooks = {};
    hooks['message.updated'] = [{ matcher: '*', hooks: [{ type: 'command', command: 'node ${KILO_PLUGIN_ROOT}/bin/plugkit.js hook prompt-submit', timeout: 60000 }] }];
    hooks['session.closing'] = [{ matcher: '*', hooks: [
      { type: 'command', command: 'node ${KILO_PLUGIN_ROOT}/bin/plugkit.js hook stop', timeout: 300000 },
      { type: 'command', command: 'node ${KILO_PLUGIN_ROOT}/bin/plugkit.js hook stop-git', timeout: 60000 }
    ] }];
    return hooks;
  },
  getAdditionalFiles(spec) {
    return {
      'index.js': `module.exports = { GmPlugin: require('./gm-kilo.mjs').GmPlugin };\n`,
      'gm.js': `module.exports = require('./gm-kilo.mjs');\n`,
      'gm-kilo.mjs': pluginMjsSource('gm-kilo'),
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

function createQwenInstallerScript() {
  return createCliInstaller({
    pkg: 'gm-qwen',
    label: 'Qwen Code',
    destDir: `path.join(homeDir, '.qwen', 'extensions', 'gm-qwen')`,
    filesToCopy: [
      ['agents', 'agents'], ['hooks', 'hooks'], ['scripts', 'scripts'], ['skills', 'skills'],
      ['bin', 'bin'], ['gm.json', 'gm.json'], ['README.md', 'README.md'], ['CLAUDE.md', 'CLAUDE.md'], ['AGENTS.md', 'AGENTS.md']
    ],
    restartMsg: 'Restart Qwen Code to activate.',
    extraSetup: `
  const qwenExtJson = path.join(destDir, 'qwen-extension.json');
  if (!fs.existsSync(qwenExtJson)) {
    const pkg = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf-8'));
    fs.writeFileSync(qwenExtJson, JSON.stringify({
      name: 'gm',
      version: pkg.version,
      description: pkg.description,
      hooks: './hooks/hooks.json',
      skills: './skills'
    }, null, 2) + '\\n');
  }
`
  });
}

const qwen = factory('qwen', 'Qwen Code', 'qwen-extension.json', 'CLAUDE.md', {
  formatConfigJson(config) {
    return makePackageJson({ ...config, author: { name: config.author, url: 'https://github.com/AnEntrypoint' } });
  },
  getPackageJsonFields() {
    return {
      files: ['agents/', 'bin/', 'hooks/', 'scripts/', 'skills/', 'gm.json', 'cli.js', 'install.js', 'README.md', 'CLAUDE.md', 'AGENTS.md', '.gitignore', 'CONTRIBUTING.md'],
      keywords: ['qwen-code', 'agent', 'state-machine', 'automation', 'gm'],
      peerDependencies: { '@qwen-code/qwen-code': '*' }
    };
  },
  getAdditionalFiles(spec) {
    return {
      'qwen-extension.json': JSON.stringify({
        name: spec.name,
        version: spec.version,
        description: spec.description,
        author: { name: spec.author, url: 'https://github.com/AnEntrypoint' },
        homepage: spec.homepage,
        hooks: './hooks/hooks.json',
        skills: './skills',
        mcpServers: {}
      }, null, 2),
      'cli.js': createQwenInstallerScript(),
    };
  },
  buildHooksMap() {
    const root = '${CLAUDE_PLUGIN_ROOT}';
    return {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${root}/bin/plugkit.js hook pre-tool-use`, timeout: 3600 }] }],
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${root}/bin/plugkit.js hook session-start`, timeout: 180000 }] }],
      UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${root}/bin/plugkit.js hook prompt-submit`, timeout: 60000 }] }],
      PreCompact: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${root}/bin/plugkit.js hook pre-compact`, timeout: 30000 }] }],
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: `node ${root}/bin/plugkit.js hook stop`, timeout: 300000 }] }, { matcher: '*', hooks: [{ type: 'command', command: `node ${root}/bin/plugkit.js hook stop-git`, timeout: 60000 }] }]
    };
  },
  generateReadme(spec) {
    return `# gm-qwen for Qwen Code

## Installation

\`\`\`bash
npm install -g gm-qwen
\`\`\`

Or install directly:

\`\`\`bash
qwen extensions install https://github.com/AnEntrypoint/gm-qwen
\`\`\`

Restart Qwen Code to activate.

## What it does

Installs the gm state machine agent (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE) into Qwen Code with full hook support, skills, and automated git enforcement.
`;
  }
});

function createHermesInstallerScript() {
  return createCliInstaller({
    pkg: 'gm-hermes',
    label: 'Hermes Agent',
    destDir: `path.join(homeDir, '.hermes', 'skills', 'gm')`,
    filesToCopy: [
      ['skills', '.'], ['README.md', 'README.md']
    ],
    restartMsg: 'Restart Hermes to activate skills. Invoke via /gm or /planning.'
  });
}

const hermes = factory('hermes', 'Hermes Agent', 'hermes-skill.json', 'AGENTS.md', {
  generatePackageJson: null,
  getPackageJsonFields() {
    return {
      files: ['skills/', 'cli.js', 'README.md', 'AGENTS.md', 'hermes-skill.json', 'index.html'],
      keywords: ['hermes-agent', 'hermes', 'agent', 'state-machine', 'automation', 'gm']
    };
  },
  formatConfigJson(config) {
    return JSON.stringify({
      name: config.name,
      version: config.version,
      description: config.description,
      author: config.author,
      homepage: config.homepage,
      skills: './skills',
      category: 'software-development'
    }, null, 2);
  },
  getAdditionalFiles(spec) {
    return {
      'hermes-skill.json': JSON.stringify({
        name: spec.name,
        version: spec.version,
        description: spec.description,
        author: spec.author,
        homepage: spec.homepage,
        skills: './skills',
        category: 'software-development'
      }, null, 2),
      'cli.js': createHermesInstallerScript()
    };
  },
  buildHooksMap() {
    return {};
  },
  loadSkillsFromSource(sourceDir) {
    const fs = require('fs');
    const path = require('path');
    const skillsDir = path.join(sourceDir, 'skills');
    const result = {};
    if (!fs.existsSync(skillsDir)) return result;
    try {
      fs.readdirSync(skillsDir).forEach(skillName => {
        const skillPath = path.join(skillsDir, skillName);
        if (!fs.statSync(skillPath).isDirectory()) return;
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) return;
        const raw = fs.readFileSync(skillMdPath, 'utf-8');
        const hasFrontmatter = raw.startsWith('---');
        const content = hasFrontmatter ? raw : `---\nname: ${skillName}\ndescription: ${skillName} skill for gm state machine\nversion: 1.0.0\nauthor: gm\nlicense: MIT\nmetadata:\n  hermes:\n    tags: [gm, state-machine, software-development]\n---\n\n${raw}`;
        result[`skills/${skillName}/SKILL.md`] = content;
      });
    } catch (e) {}
    return result;
  },
  generateReadme(spec) {
    return `# gm-hermes for Hermes Agent

## Installation

\`\`\`bash
npm install -g gm-hermes
\`\`\`

Or install directly:

\`\`\`bash
npx gm-hermes
\`\`\`

Restart Hermes Agent to activate skills.

## What it does

Installs the gm state machine skills (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE) into Hermes Agent under \`~/.hermes/skills/gm/skills/software-development/\`.

Use \`/gm\` or invoke skills by name in Hermes to access the full state machine workflow.
`;
  }
});

module.exports = { cc, gc, codex, oc, kilo, qwen, hermes };
