const vscode = require('vscode');

let agents = {};

async function activate(context) {
  console.log('Cursor extension activated');

  try {
    const fsPath = context.extensionPath;
    const gm = require('./gm.md');
    const codesearch = require('./codesearch.md');
    const websearch = require('./websearch.md');

    agents = { gm, codesearch, websearch };
    context.subscriptions.push(
      vscode.commands.registerCommand('cursor.showAgents', () => {
        console.log('Available agents:', Object.keys(agents));
      })
    );
  } catch (e) {
    console.error('Failed to activate Cursor extension:', e);
  }
}

function deactivate() {
  console.log('Cursor extension deactivated');
}

module.exports = { activate, deactivate };
