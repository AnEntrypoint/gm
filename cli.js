#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const AutoGenerator = require('./lib/auto-generator');

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
gm-builder - Convention-driven multi-platform plugin builder

Usage:
  gm-builder <plugin-dir> [output-dir]

Arguments:
  plugin-dir    Path to plugin directory (must contain gm.json)
  output-dir    Output directory (default: ./gm-build)

Examples:
  gm-builder ./my-plugin
  gm-builder ./my-plugin /tmp/build

Description:
  Automatically generates 8 platform outputs from a single plugin directory:
  - Claude Code (cc)
  - Gemini CLI (gc)
  - OpenCode (oc)
  - VS Code (vscode)
  - Cursor (cursor)
  - Zed (zed)
  - JetBrains (jetbrains)
  - Copilot (copilot)

Plugin Directory Structure:
  plugin/
  ├── gm.json          # Single truth source
  ├── agents/               # Auto-detected
  │   ├── gm.md
  │   ├── codesearch.md
  │   └── websearch.md
  ├── hooks/                # Unified platform-agnostic
  │   ├── session-start.js
  │   ├── pre-tool.js
  │   ├── prompt-submit.js
  │   ├── stop.js
  │   └── stop-git.js
  └── lib/                  # Optional utilities

Zero configuration required. Just create the plugin structure and run!
`);
    process.exit(0);
  }

  const pluginDir = path.resolve(args[0]);
  const outputDir = path.resolve(args[1] || './gm-build');

  if (!fs.existsSync(pluginDir)) {
    console.error('Plugin directory not found:', pluginDir);
    process.exit(1);
  }

  const gmJsonPath = path.join(pluginDir, 'gm.json');

  if (!fs.existsSync(gmJsonPath)) {
    console.error('gm.json not found in:', pluginDir);
    process.exit(1);
  }

  try {
    const generator = new AutoGenerator(pluginDir, outputDir);
    await generator.generate();
    generator.logResults();
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
};

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
