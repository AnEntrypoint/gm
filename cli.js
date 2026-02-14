#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const AutoGenerator = require('./lib/auto-generator');

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
glootie-builder - Convention-driven multi-platform plugin builder

Usage:
  glootie-builder <plugin-dir> [output-dir]

Arguments:
  plugin-dir    Path to plugin directory (must contain glootie.json)
  output-dir    Output directory (default: ./glootie-build)

Examples:
  glootie-builder ./my-plugin
  glootie-builder ./my-plugin /tmp/build

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
  ├── glootie.json          # Single truth source
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
  const outputDir = path.resolve(args[1] || './glootie-build');

  if (!fs.existsSync(pluginDir)) {
    console.error('Plugin directory not found:', pluginDir);
    process.exit(1);
  }

  const glootieJsonPath = path.join(pluginDir, 'glootie.json');

  if (!fs.existsSync(glootieJsonPath)) {
    console.error('glootie.json not found in:', pluginDir);
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
