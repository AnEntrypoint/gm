#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const isProjectLocal = args.includes('-p') || args.includes('--provision') || args.includes('--project');

if (isProjectLocal) {
  provisionProject();
} else {
  installGlobally();
}

function provisionProject() {
  const projectDir = process.cwd();
  const claudeDir = path.join(projectDir, '.claude');
  const srcDir = __dirname;

  console.log('Provisioning gm-cc to current project...');

  try {
    const filesToCopy = [
      'agents',
      'hooks',
      'skills',
      '.mcp.json'
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

    filesToCopy.forEach(name => copyRecursive(path.join(srcDir, name), path.join(claudeDir, name)));

    // Update .gitignore to exclude .gm-stop-verified
    const gitignorePath = path.join(projectDir, '.gitignore');
    const gitignoreEntry = '.gm-stop-verified';

    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    }

    if (!gitignoreContent.includes(gitignoreEntry)) {
      if (gitignoreContent && !gitignoreContent.endsWith('\n')) {
        gitignoreContent += '\n';
      }
      gitignoreContent += gitignoreEntry + '\n';
      fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
    }

    // Generate project-specific settings.json with hook configuration
    const settingsPath = path.join(claudeDir, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch (e) {}
    }

    // Configure hooks to use project-local paths with ${CLAUDE_PROJECT_DIR}
    if (!settings.hooks) settings.hooks = {};
    settings.hooks.PreToolUse = [{
      matcher: '*',
      hooks: [{
        type: 'command',
        command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/pre-tool-use-hook.js',
        timeout: 3600
      }]
    }];
    settings.hooks.SessionStart = [{
      matcher: '*',
      hooks: [{
        type: 'command',
        command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/session-start-hook.js',
        timeout: 180000
      }]
    }];
    settings.hooks.UserPromptSubmit = [{
      matcher: '*',
      hooks: [{
        type: 'command',
        command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/prompt-submit-hook.js',
        timeout: 60000
      }]
    }];
    settings.hooks.Stop = [{
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-hook.js',
          timeout: 300000
        },
        {
          type: 'command',
          command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-hook-git.js',
          timeout: 60000
        }
      ]
    }];

    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    console.log('✓ Hooks copied to .claude/hooks/');
    console.log('✓ Agents copied to .claude/agents/');
    console.log('✓ Skills copied to .claude/skills/');
    console.log('✓ MCP configuration written to .claude/.mcp.json');
    console.log('✓ Hook configuration written to .claude/settings.json');
    console.log('✓ .gitignore updated');
    console.log('');
    console.log('Provisioning complete! Your project now has:');
    console.log('  • All gm-cc hooks in .claude/hooks/');
    console.log('  • All agents in .claude/agents/');
    console.log('  • All skills in .claude/skills/');
    console.log('  • Hook configuration in .claude/settings.json');
    console.log('');
    console.log('Restart Claude Code to activate the hooks.');
  } catch (e) {
    console.error('Provisioning failed:', e.message);
    process.exit(1);
  }
}

function installGlobally() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const claudeDir = path.join(homeDir, '.claude');
  const pluginsDir = path.join(claudeDir, 'plugins');
  const destDir = path.join(pluginsDir, 'gm-cc');

  const srcDir = __dirname;
  const isUpgrade = fs.existsSync(destDir);

  console.log(isUpgrade ? 'Upgrading gm-cc plugin...' : 'Installing gm-cc plugin...');

  try {
    fs.mkdirSync(destDir, { recursive: true });

    const filesToCopy = [
      'agents',
      'hooks',
      'skills',
      '.mcp.json',
      '.claude-plugin',
      'README.md',
      'CLAUDE.md'
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

    filesToCopy.forEach(name => copyRecursive(path.join(srcDir, name), path.join(destDir, name)));

    // Copy plugin.json and marketplace.json to root so marketplace source lookup finds them
    const pluginJsonSrc = path.join(destDir, '.claude-plugin', 'plugin.json');
    if (fs.existsSync(pluginJsonSrc)) fs.copyFileSync(pluginJsonSrc, path.join(destDir, 'plugin.json'));
    const mktSrc = path.join(destDir, '.claude-plugin', 'marketplace.json');
    if (fs.existsSync(mktSrc)) fs.copyFileSync(mktSrc, path.join(destDir, 'marketplace.json'));

    // Register in settings.json (enabledPlugins only, no hook injection)
    const settingsPath = path.join(claudeDir, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch (e) {}
    }
    if (!settings.enabledPlugins) settings.enabledPlugins = {};
    settings.enabledPlugins['gm@gm-cc'] = true;
    // Remove stale hook entries (handled by plugin hooks.json)
    if (settings.hooks) delete settings.hooks;
    // Register marketplace so Claude Code resolves gm@gm-cc locally
    if (!settings.extraKnownMarketplaces) settings.extraKnownMarketplaces = {};
    settings.extraKnownMarketplaces['gm-cc'] = { source: { source: 'directory', path: destDir } };
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('✓ Plugin registered in ~/.claude/settings.json');

    // Write installed_plugins.json so Claude Code loads from local cache
    const pluginVersion = require('./package.json').version;
    const installedPluginsPath = path.join(pluginsDir, 'installed_plugins.json');
    let installedPlugins = { version: 2, plugins: {} };
    if (fs.existsSync(installedPluginsPath)) {
      try { installedPlugins = JSON.parse(fs.readFileSync(installedPluginsPath, 'utf-8')); } catch (e) {}
    }
    if (!installedPlugins.plugins || Array.isArray(installedPlugins.plugins)) installedPlugins.plugins = {};
    const now = new Date().toISOString();
    const existing = Array.isArray(installedPlugins.plugins['gm@gm-cc']) ? installedPlugins.plugins['gm@gm-cc'][0] : null;
    // Also write cache dir so Claude Code finds it without network fetch
    const cacheDir = path.join(pluginsDir, 'cache', 'gm-cc', 'gm', pluginVersion);
    const filesToCache = ['agents', 'hooks', 'skills', '.mcp.json', '.claude-plugin', 'README.md', 'CLAUDE.md'];
    function copyRecursiveCache(src, dst) {
      if (!fs.existsSync(src)) return;
      if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        fs.readdirSync(src).forEach(f => copyRecursiveCache(path.join(src, f), path.join(dst, f)));
      } else { fs.copyFileSync(src, dst); }
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    filesToCache.forEach(name => copyRecursiveCache(path.join(destDir, name), path.join(cacheDir, name)));
    // Copy plugin.json and marketplace.json to cache root too
    const cachePluginJsonSrc = path.join(cacheDir, '.claude-plugin', 'plugin.json');
    if (fs.existsSync(cachePluginJsonSrc)) fs.copyFileSync(cachePluginJsonSrc, path.join(cacheDir, 'plugin.json'));
    const mktCacheSrc = path.join(cacheDir, '.claude-plugin', 'marketplace.json');
    if (fs.existsSync(mktCacheSrc)) fs.copyFileSync(mktCacheSrc, path.join(cacheDir, 'marketplace.json'));
    installedPlugins.plugins['gm@gm-cc'] = [{
      scope: 'user',
      installPath: cacheDir,
      version: pluginVersion,
      installedAt: existing?.installedAt || now,
      lastUpdated: now
    }];
    fs.writeFileSync(installedPluginsPath, JSON.stringify(installedPlugins, null, 2), 'utf-8');
    console.log('✓ Plugin registered in installed_plugins.json');

    // Clean up stale cache entries to avoid validation errors from old formats
    try {
      const gmCacheDir = path.join(pluginsDir, 'cache', 'gm-cc', 'gm');
      if (fs.existsSync(gmCacheDir)) {
        const entries = fs.readdirSync(gmCacheDir);
        for (const entry of entries) {
          if (entry === pluginVersion || entry === 'unknown') continue;
          try { fs.rmSync(path.join(gmCacheDir, entry), { recursive: true, force: true }); } catch (e) {}
        }
      }
    } catch (e) {}

    console.log(`✓ gm-cc ${isUpgrade ? 'upgraded' : 'installed'} to ${destDir}`);
    console.log('Restart Claude Code to activate the gm plugin.');
  } catch (e) {
    console.error('Installation failed:', e.message);
    process.exit(1);
  }
}
