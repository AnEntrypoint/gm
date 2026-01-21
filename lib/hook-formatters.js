class HookFormatters {
  static formatCCHook(content, eventName) {
    return `const hook = async (context) => {
${content.split('\n').map(line => '  ' + line).join('\n')}
};

module.exports = { name: '${eventName}', handler: hook };`;
  }

  static formatGCHook(content, eventName) {
    return `exports.${eventName} = async (context) => {
${content.split('\n').map(line => '  ' + line).join('\n')}
};`;
  }

  static formatOCSDK(content, className) {
    return `class ${className} {
  async handle(context) {
${content.split('\n').map(line => '    ' + line).join('\n')}
  }
}

module.exports = ${className};`;
  }

  static formatVSCodeHook(content, eventName) {
    return `import * as vscode from 'vscode';

export async function ${eventName}(context: vscode.ExtensionContext) {
${content.split('\n').map(line => '  ' + line).join('\n')}
}`;
  }

  static formatVSCodeActivate(content) {
    return `import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
${content.split('\n').map(line => '  ' + line).join('\n')}
}`;
  }

  static formatVSCodeDeactivate(content) {
    return `export async function deactivate() {
${content.split('\n').map(line => '  ' + line).join('\n')}
}`;
  }

  static formatCursorHook(content, eventName) {
    return `export async function ${eventName}() {
${content.split('\n').map(line => '  ' + line).join('\n')}
}`;
  }

  static formatCursorActivate(content) {
    return `export async function activate() {
${content.split('\n').map(line => '  ' + line).join('\n')}
}`;
  }

  static formatCursorDeactivate(content) {
    return `export async function deactivate() {
${content.split('\n').map(line => '  ' + line).join('\n')}
}`;
  }

  static formatZedHook(content, eventName) {
    return `export async fn ${eventName}() -> zed::Result<()> {
${content.split('\n').map(line => '    ' + line).join('\n')}
  Ok(())
}`;
  }

  static formatJetBrainsHook(content, eventName) {
    return `override fun ${eventName}() {
${content.split('\n').map(line => '    ' + line).join('\n')}
}`;
  }

  static formatCopilotHook(content, eventName) {
    return `async function ${eventName}(): Promise<void> {
${content.split('\n').map(line => '  ' + line).join('\n')}
}

export { ${eventName} };`;
  }

  static toCamelCase(str) {
    return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase())
              .charAt(0).toUpperCase() + str.replace(/-([a-z])/g, (g) => g[1].toUpperCase()).slice(1);
  }
}

module.exports = HookFormatters;
