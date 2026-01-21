const vscodeManifest = (pluginSpec) => JSON.stringify({
  name: 'glootie-vscode',
  version: pluginSpec.version,
  publisher: 'glootie',
  displayName: 'Glootie - GM State Machine',
  description: pluginSpec.description || 'AI-powered state machine for VSCode with dynamic adaptation',
  author: pluginSpec.author || 'Glootie',
  license: pluginSpec.license || 'MIT',
  repository: { type: 'git', url: 'https://github.com/AnEntrypoint/glootie-vscode.git' },
  bugs: { url: 'https://github.com/AnEntrypoint/glootie-vscode/issues' },
  engines: { vscode: '^1.85.0' },
  categories: ['AI', 'Debuggers', 'Other'],
  activationEvents: ['*'],
  contributes: {
    views: {
      'glootie-explorer': [
        { id: 'glootie.state', name: 'State Machine' },
        { id: 'glootie.agents', name: 'Agents' }
      ]
    },
    commands: [
      { command: 'glootie.activate', title: 'Glootie: Activate' },
      { command: 'glootie.deactivate', title: 'Glootie: Deactivate' },
      { command: 'glootie.showState', title: 'Glootie: Show State' }
    ],
    configuration: {
      title: 'Glootie',
      properties: {
        'glootie.enabled': { type: 'boolean', default: true, description: 'Enable Glootie extension' },
        'glootie.logLevel': { type: 'string', enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
        'glootie.autoActivate': { type: 'boolean', default: true, description: 'Auto-activate on startup' }
      }
    }
  },
  keywords: ['ai', 'state-machine', 'gm', 'glootie', 'automation', 'development'],
  main: './extension.js',
  files: ['extension.js', 'agents/', 'README.md']
}, null, 2);

const cursorManifest = (pluginSpec) => JSON.stringify({
  name: 'glootie-cursor',
  version: pluginSpec.version,
  publisher: 'glootie',
  displayName: 'Glootie - GM State Machine',
  description: pluginSpec.description || 'AI-powered state machine for Cursor with autonomous decision-making',
  author: pluginSpec.author || 'Glootie',
  license: pluginSpec.license || 'MIT',
  repository: { type: 'git', url: 'https://github.com/AnEntrypoint/glootie-cursor.git' },
  bugs: { url: 'https://github.com/AnEntrypoint/glootie-cursor/issues' },
  engines: { vscode: '^1.85.0' },
  categories: ['AI', 'Other'],
  activationEvents: ['*'],
  keywords: ['ai', 'state-machine', 'gm', 'glootie', 'cursor'],
  main: './extension.js',
  files: ['.cursor/', 'extension.js', 'agents/', 'README.md']
}, null, 2);

const zedManifest = (pluginSpec) => ({
  name: 'glootie',
  version: pluginSpec.version,
  description: pluginSpec.description || 'AI-powered state machine for Zed',
  authors: [{ name: pluginSpec.author || 'Glootie' }],
  repository: 'https://github.com/AnEntrypoint/glootie-zed',
  themes: [
    { name: 'Glootie Dark', appearance: 'dark', path: './themes/glootie-dark.json' },
    { name: 'Glootie Light', appearance: 'light', path: './themes/glootie-light.json' }
  ]
});

const jetbrainsPluginXml = (pluginSpec) => `<?xml version="1.0" encoding="UTF-8"?>
<idea-plugin url="https://github.com/AnEntrypoint/glootie-jetbrains">
  <id>com.glootie.intellij</id>
  <name>Glootie - GM State Machine</name>
  <version>${pluginSpec.version}</version>
  <vendor email="glootie@anthropic.ai" url="https://github.com/AnEntrypoint">Glootie</vendor>
  <description>${pluginSpec.description || 'AI-powered state machine for JetBrains IDEs'}</description>
  <category>AI</category>
  <change-notes>
    <![CDATA[
    <ul>
      <li>State machine core with checkpointing and recovery</li>
      <li>Autonomous agent coordination</li>
      <li>MCP integration for tool access</li>
      <li>Real-time state inspection</li>
      <li>Hot reload support</li>
    </ul>
    ]]>
  </change-notes>
  <idea-version since-build="223.0"/>
  <depends>com.intellij.modules.platform</depends>
</idea-plugin>`;

module.exports = {
  vscodeManifest,
  cursorManifest,
  zedManifest,
  jetbrainsPluginXml
};
