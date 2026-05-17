#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const AutoGenerator = require('./lib/auto-generator');

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
gm-builder - Build gm-skill canonical universal harness

Usage:
  gm-builder <plugin-dir> [output-dir]

Arguments:
  plugin-dir    Path to plugin directory (must contain gm.json)
  output-dir    Output directory (default: ./gm-build)

Examples:
  gm-builder ./gm-starter
  gm-builder ./gm-starter /tmp/build

Description:
  Generates the single gm-skill npm package — the canonical universal
  harness. Plugkit serves all phase instructions, state, mutables, and
  guardrails on demand via the spool. Invokable from any AI coding host.

Plugin Directory Structure:
  plugin/
  ├── gm.json     # Single truth source
  ├── agents/     # Agent markdown definitions
  ├── skills/     # Skill SKILL.md definitions
  ├── prompts/    # Prompt text files
  ├── scripts/    # Helper scripts
  ├── lang/       # Language plugins
  ├── lib/        # Runtime utilities
  └── gm-plugkit/ # Spool watcher + WASM wrapper
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
