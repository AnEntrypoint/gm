#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

const commands = {
  help() {
    console.log(`glootie v${pkg.version} - AI State Machine Agent`);
    console.log('Usage: glootie [command]');
    console.log('Commands:');
    console.log('  help      Show this help');
    console.log('  version   Show version');
    console.log('  status    Show status');
    console.log('  config    Show config');
  },

  version() {
    console.log(pkg.version);
  },

  status() {
    console.log('Status: Active');
    console.log('Mode: Autonomous');
    console.log('State: Ready');
  },

  config() {
    console.log(JSON.stringify({
      enabled: true,
      autoActivate: true,
      contextWindow: 200000
    }, null, 2));
  }
};

const cmd = process.argv[2] || 'help';
if (commands[cmd]) {
  commands[cmd]();
} else {
  console.error(`Unknown command: ${cmd}`);
  commands.help();
  process.exit(1);
}