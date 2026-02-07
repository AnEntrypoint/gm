const vscode = require('vscode');

class GlootieExtension {
  constructor(context) {
    this.context = context;
    this.isActive = false;
  }

  async activate() {
    this.isActive = true;
    console.log('Glootie extension activated');
    this.registerCommands();
    this.registerViews();
    this.setupConfiguration();
    this.showCodeSearchInfo();
  }

  registerCommands() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('glootie.activate', () => {
        vscode.window.showInformationMessage('Glootie activated');
      }),
      vscode.commands.registerCommand('glootie.deactivate', () => {
        vscode.window.showInformationMessage('Glootie deactivated');
      }),
      vscode.commands.registerCommand('glootie.showState', () => {
        vscode.window.showInformationMessage('Glootie state machine');
      })
    );
  }

  registerViews() {}

  setupConfiguration() {
    const config = vscode.workspace.getConfiguration('glootie');
    this.isActive = config.get('autoActivate', true);
  }

  showCodeSearchInfo() {
    const message = 'Glootie uses semantic code search - describe intent ("find auth logic") not regex. Use code-search to explore your codebase across files. Open README.md for details.';
    vscode.window.showInformationMessage(message, 'Learn More').then(selection => {
      if (selection === 'Learn More') {
        vscode.commands.executeCommand('workbench.action.openAbstractDialog');
      }
    });
  }

  deactivate() {
    this.isActive = false;
    console.log('Glootie extension deactivated');
  }
}

let glootie;

function activate(context) {
  glootie = new GlootieExtension(context);
  glootie.activate();
}

function deactivate() {
  if (glootie) {
    glootie.deactivate();
  }
}

module.exports = { activate, deactivate };
