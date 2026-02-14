#!/usr/bin/env node

const show = () => {
  console.log('glootie-gc: Advanced Gemini CLI extension');
  console.log('Version: 2.0.9');
  console.log('');
  console.log('Usage: glootie-gc [command]');
  console.log('Commands:');
  console.log('  help, --help, -h');
  console.log('  version, --version');
};

const args = process.argv.slice(2);
if (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  show();
} else if (args[0] === 'version' || args[0] === '--version') {
  console.log('2.0.9');
}
