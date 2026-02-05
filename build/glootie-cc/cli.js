#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const pkg = require('./package.json');
const install = require('./install.js');
const uninstall = require('./uninstall.js');

const args = process.argv.slice(2);
const cmd = args[0];
const target = args.find(a => !a.startsWith('--'));
const flags = {
  backup: args.includes('--backup'),
  force: args.includes('--force'),
  verbose: args.includes('--verbose'),
  verify: args.includes('--verify')
};

function showHelp() {
  console.log(`
glootie-cc - Claude Code agent installer

USAGE:
  glootie install [target] [options]    Install to target directory
  glootie uninstall [target] [options]  Uninstall from target directory
  glootie --version                     Show version
  glootie --help                        Show this help

OPTIONS:
  --backup                              Backup existing files before installing
  --force                               Overwrite without warning
  --verbose                             Show detailed output
  --verify                              Verify installation after completion

EXAMPLES:
  glootie install                       Install to current directory
  glootie install /path/to/repo         Install to specific directory
  glootie install --backup --verbose    Install with backup and detailed output
  glootie uninstall                     Uninstall from current directory
`);
}

function showVersion() {
  console.log(`glootie-cc v${pkg.version}`);
}

async function runInstall() {
  try {
    const targetDir = target || process.cwd();
    const opts = {
      targetDir,
      verbose: flags.verbose,
      backup: flags.backup,
      force: flags.force,
      verify: flags.verify
    };
    await install(opts);
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function runUninstall() {
  try {
    const targetDir = target || process.cwd();
    const opts = {
      targetDir,
      verbose: flags.verbose
    };
    await uninstall(opts);
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (cmd === '--help' || cmd === '-h') {
  showHelp();
  process.exit(0);
} else if (cmd === '--version' || cmd === '-v') {
  showVersion();
  process.exit(0);
} else if (cmd === 'install') {
  runInstall();
} else if (cmd === 'uninstall') {
  runUninstall();
} else if (!cmd) {
  console.log('No command specified. Use --help for usage.');
  process.exit(1);
} else {
  console.log(`Unknown command: ${cmd}. Use --help for usage.`);
  process.exit(1);
}
