const fs = require('fs');
const path = require('path');

class TemplateBuilder {
  static loadSkillsFromSource(sourceDir, baseOutputPath = 'skills') {
    const skillsDir = path.join(sourceDir, 'skills');
    const skills = {};

    if (!fs.existsSync(skillsDir)) {
      return skills;
    }

    try {
      fs.readdirSync(skillsDir).forEach(skillName => {
        const skillPath = path.join(skillsDir, skillName);
        const stat = fs.statSync(skillPath);
        if (stat.isDirectory()) {
          const skillMdPath = path.join(skillPath, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            skills[`${baseOutputPath}/${skillName}/SKILL.md`] = content;
          }
        }
      });
    } catch (e) {}

    return skills;
  }

  static loadScriptsFromSource(sourceDir, baseOutputPath = 'scripts') {
    const scriptsDir = path.join(sourceDir, 'scripts');
    const scripts = {};

    if (!fs.existsSync(scriptsDir)) {
      return scripts;
    }

    try {
      fs.readdirSync(scriptsDir).forEach(fileName => {
        const filePath = path.join(scriptsDir, fileName);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const content = fs.readFileSync(filePath, 'utf-8');
          scripts[`${baseOutputPath}/${fileName}`] = content;
        }
      });
    } catch (e) {}

    return scripts;
  }

  static generatePackageJson(pluginSpec, adapterName, extraFields = {}) {
    return JSON.stringify({
      name: `${pluginSpec.name}-${adapterName}`,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      keywords: pluginSpec.keywords,
      ...(pluginSpec.scripts && { scripts: pluginSpec.scripts }),
      repository: {
        type: 'git',
        url: `https://github.com/AnEntrypoint/${pluginSpec.name}-${adapterName}.git`
      },
      homepage: `https://github.com/AnEntrypoint/${pluginSpec.name}-${adapterName}#readme`,
      bugs: {
        url: `https://github.com/AnEntrypoint/${pluginSpec.name}-${adapterName}/issues`
      },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      ...extraFields
    }, null, 2);
  }

  static generateMcpJson(pluginSpec) {
    return JSON.stringify({
      $schema: 'https://schemas.modelcontextprotocol.io/0.1.0/mcp.json',
      mcpServers: pluginSpec.mcp || {}
    }, null, 2);
  }

  static generatePluginJson(pluginSpec) {
    return JSON.stringify({
      name: pluginSpec.name,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: {
        name: pluginSpec.author,
        url: 'https://github.com/AnEntrypoint'
      },
      homepage: pluginSpec.homepage,
      hooks: './hooks/hooks.json',
      mcpServers: pluginSpec.mcp || {}
    }, null, 2);
  }

  static generateMarketplaceJson(pluginSpec, marketplaceName) {
    return JSON.stringify({
      name: marketplaceName || 'gm',
      owner: {
        name: pluginSpec.author
      },
      description: pluginSpec.description,
      version: pluginSpec.version,
      metadata: {
        description: pluginSpec.description
      },
      plugins: [
        {
          name: 'gm',
          source: './'
        }
      ]
    }, null, 2);
  }

  static buildHooksMap(hookEventNames, hookOutputFormat = 'wrapped') {
    const hooks = {};
    const hookDefs = [
      { event: 'preTool', file: 'pre-tool-use-hook.js', timeout: 3600 },
      { event: 'sessionStart', file: 'session-start-hook.js', timeout: 10000 },
      { event: 'promptSubmit', file: 'prompt-submit-hook.js', timeout: 3600 },
      { event: 'stop', files: [
        { file: 'stop-hook.js', timeout: 300000 },
        { file: 'stop-hook-git.js', timeout: 60000 }
      ]}
    ];

    hookDefs.forEach(def => {
      const eventKey = hookEventNames[def.event];
      if (!eventKey) return;
      if (def.files) {
        const cmds = def.files.map(f => this.createCommand(f.file, f.timeout));
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmds : [{ matcher: '*', hooks: cmds }];
      } else {
        const cmd = [this.createCommand(def.file, def.timeout)];
        hooks[eventKey] = hookOutputFormat === 'bare' ? cmd[0] : [{ matcher: '*', hooks: cmd }];
      }
    });

    return hooks;
  }

  static createCommand(hookFile, timeout) {
    return {
      type: 'command',
      command: `node \${__dirname}/${hookFile}`,
      timeout
    };
  }

  static buildHookCommandWithEnv(hookFile, envVar) {
    return `node \${${envVar}}/${hookFile}`;
  }

  static getGenericFiles() {
    return {
      '.gitignore': this.generateGitignore(),
      'LICENSE': this.generateLicense(),
      '.editorconfig': this.generateEditorConfig(),
      'CONTRIBUTING.md': this.generateContributing()
    };
  }

  static getCliGenericFiles() {
    return {
      ...this.getGenericFiles(),
      '.github/workflows/publish-npm.yml': this.generatePublishNpmWorkflow()
    };
  }

  static generateGitignore() {
    return `node_modules/
*.log
*.swp
*.swo
.DS_Store
dist/
build/
*.tmp
.env
.env.local
.vscode/
.idea/
*.iml
`;
  }

  static generateLicense() {
    return `MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
  }

  static generateEditorConfig() {
    return `root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
`;
  }

  static generateContributing() {
    return `# Contributing

Please ensure all code follows the conventions established in this project.

## Before Committing

Run the build to verify everything is working:

\`\`\`bash
npm run build plugforge-starter [output-dir]
\`\`\`

## Platform Conventions

- Each platform adapter in \`platforms/\` extends PlatformAdapter or CLIAdapter
- File generation logic goes in \`createFileStructure()\`
- Use TemplateBuilder methods for shared generation logic
- Skills are auto-discovered from plugforge-starter/skills/

## Testing

Build all 9 platform outputs:

\`\`\`bash
node cli.js plugforge-starter /tmp/test-build
\`\`\`
`;
  }

  static generatePublishNpmWorkflow() {
    return `name: Publish to npm

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - name: Publish to npm
        run: |
          PACKAGE=\$(jq -r '.name' package.json)
          VERSION=\$(jq -r '.version' package.json)
          echo "Package: \$PACKAGE@\$VERSION"

          # Skip if this exact version is already on npm
          PUBLISHED=\$(npm view "\$PACKAGE@\$VERSION" version 2>/dev/null || echo "")
          if [ "\$PUBLISHED" = "\$VERSION" ]; then
            echo "✅ \$PACKAGE@\$VERSION already published - skipping"
            exit 0
          fi

          echo "Publishing \$PACKAGE@\$VERSION..."
          npm publish --access public
          echo "✅ Published \$PACKAGE@\$VERSION"
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;
  }

  static getPlatformPageConfig(adapterName, pluginSpec) {
    const meta = {
      cc: { repoId: 'gm-cc', label: 'Claude Code', type: 'cli', badgeLabel: 'cc', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-cc' }, { desc: 'Restart Claude Code — activates automatically' }] },
      gc: { repoId: 'gm-gc', label: 'Gemini CLI', type: 'cli', badgeLabel: 'gc', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-gc' }, { desc: 'Restart Gemini CLI — hooks activate on next session' }] },
      oc: { repoId: 'gm-oc', label: 'OpenCode', type: 'cli', badgeLabel: 'oc', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-oc' }, { desc: 'Restart OpenCode — activates automatically' }] },
      kilo: { repoId: 'gm-kilo', label: 'Kilo Code', type: 'cli', badgeLabel: 'kilo', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-kilo' }, { desc: 'Restart Kilo Code — activates automatically' }] },
      codex: { repoId: 'gm-codex', label: 'Codex', type: 'cli', badgeLabel: 'codex', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-codex' }, { desc: 'Restart Codex — activates automatically' }] },
      'copilot-cli': { repoId: 'gm-copilot-cli', label: 'Copilot CLI', type: 'cli', badgeLabel: 'copilot-cli', installSteps: [{ desc: 'Install via GitHub CLI', cmd: 'gh extension install AnEntrypoint/gm-copilot-cli' }, { desc: 'Restart your terminal — activates automatically' }] },
      vscode: { repoId: 'gm-vscode', label: 'VS Code', type: 'ide', badgeLabel: 'vscode', installSteps: [{ desc: 'Open Extensions (Ctrl+Shift+X), search "gm", click Install' }, { desc: 'Reload VS Code — activates automatically' }] },
      cursor: { repoId: 'gm-cursor', label: 'Cursor', type: 'ide', badgeLabel: 'cursor', installSteps: [{ desc: 'Open Extensions (Ctrl+Shift+X), search "gm", click Install' }, { desc: 'Reload Cursor — activates automatically' }] },
      zed: { repoId: 'gm-zed', label: 'Zed', type: 'ide', badgeLabel: 'zed', installSteps: [{ desc: 'Build from source', cmd: 'git clone https://github.com/AnEntrypoint/gm-zed && cd gm-zed && cargo build --release' }, { desc: 'Copy to extensions dir', cmd: 'cp target/release/libgm.so ~/.config/zed/extensions/gm/' }, { desc: 'Restart Zed — activates automatically' }] },
      jetbrains: { repoId: 'gm-jetbrains', label: 'JetBrains', type: 'ide', badgeLabel: 'jetbrains', installSteps: [{ desc: 'Preferences → Plugins → Marketplace, search "gm", click Install' }, { desc: 'Restart IDE — activates automatically' }] }
    };
    const m = meta[adapterName] || { repoId: `gm-${adapterName}`, label: adapterName, type: 'cli', badgeLabel: adapterName, installSteps: [] };
    const features = [
      { title: 'State Machine', desc: 'Immutable PLAN→EXECUTE→EMIT→VERIFY→COMPLETE phases with full mutable tracking' },
      { title: 'Semantic Search', desc: 'Natural language codebase exploration via codesearch skill — no grep needed' },
      { title: 'Hooks', desc: 'Pre-tool, session-start, prompt-submit, and stop hooks for full lifecycle control' },
      { title: 'Agents', desc: 'gm, codesearch, and websearch agents pre-configured and ready to use' },
      { title: 'MCP Integration', desc: 'Model Context Protocol server support built in' },
      { title: 'Auto-Recovery', desc: 'Supervisor hierarchy ensures the system never crashes' }
    ];
    return { name: m.repoId, label: m.label, description: pluginSpec.description, type: m.type, version: pluginSpec.version, installSteps: m.installSteps, features, githubUrl: `https://github.com/AnEntrypoint/${m.repoId}`, badgeLabel: m.badgeLabel, currentPlatform: m.repoId };
  }

  static generateGitHubPage(config) {
    const {
      name,
      label,
      description,
      type,
      version,
      installSteps,
      features,
      githubUrl,
      badgeLabel,
      currentPlatform
    } = config;

    const featuresJson = JSON.stringify(features || []);
    const installStepsJson = JSON.stringify(installSteps || []);
    const typeLabel = type === 'cli' ? 'CLI Tool' : 'IDE Extension';
    const typeBadgeColor = type === 'cli' ? '#3b82f6' : '#8b5cf6';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${label} - gm plugin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
    {"imports":{"webjsx":"https://cdn.jsdelivr.net/npm/webjsx@0.0.42/dist/index.js"}}
  </script>
  <style>
    .gradient-hero { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%); }
    .card-hover { transition: transform 0.2s, box-shadow 0.2s; }
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(0,0,0,0.3); }
    pre { scrollbar-width: thin; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 font-sans">

<script type="module">
import { createElement as h, applyDiff, Fragment } from "webjsx";

const PLATFORM_NAME = ${JSON.stringify(label)};
const PLATFORM_TYPE = ${JSON.stringify(typeLabel)};
const PLATFORM_TYPE_COLOR = ${JSON.stringify(typeBadgeColor)};
const DESCRIPTION = ${JSON.stringify(description)};
const VERSION = ${JSON.stringify(version || '2.0.0')};
const GITHUB_URL = ${JSON.stringify(githubUrl || '#')};
const BADGE_LABEL = ${JSON.stringify(badgeLabel || name)};
const FEATURES = ${featuresJson};
const INSTALL_STEPS = ${installStepsJson};
const CURRENT_PLATFORM = ${JSON.stringify(currentPlatform || name)};
const ALL_PLATFORMS = [
  {id:'gm-cc',label:'Claude Code',type:'cli'},
  {id:'gm-gc',label:'Gemini CLI',type:'cli'},
  {id:'gm-oc',label:'OpenCode',type:'cli'},
  {id:'gm-kilo',label:'Kilo Code',type:'cli'},
  {id:'gm-codex',label:'Codex',type:'cli'},
  {id:'gm-copilot-cli',label:'Copilot CLI',type:'cli'},
  {id:'gm-vscode',label:'VS Code',type:'ide'},
  {id:'gm-cursor',label:'Cursor',type:'ide'},
  {id:'gm-zed',label:'Zed',type:'ide'},
  {id:'gm-jetbrains',label:'JetBrains',type:'ide'},
];

function NavBar() {
  return h('nav', { class: 'border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10' },
    h('div', { class: 'max-w-5xl mx-auto px-4 py-3 flex items-center justify-between' },
      h('div', { class: 'flex items-center gap-3' },
        h('span', { class: 'text-white font-bold text-lg' }, 'gm'),
        h('span', { class: 'text-gray-500' }, '/'),
        h('span', { class: 'text-gray-300 font-medium' }, BADGE_LABEL)
      ),
      h('a', {
        href: GITHUB_URL,
        target: '_blank',
        rel: 'noopener',
        class: 'flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm'
      },
        h('svg', { viewBox: '0 0 16 16', class: 'w-5 h-5 fill-current', 'aria-hidden': 'true' },
          h('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z' })
        ),
        'GitHub'
      )
    )
  );
}

function HeroBadge({ label, color }) {
  return h('span', {
    class: 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-white',
    style: \`background-color: \${color};\`
  }, label);
}

function Hero() {
  return h('section', { class: 'gradient-hero py-20 px-4' },
    h('div', { class: 'max-w-5xl mx-auto text-center' },
      h('div', { class: 'flex justify-center gap-2 mb-6' },
        h(HeroBadge, { label: PLATFORM_TYPE, color: PLATFORM_TYPE_COLOR }),
        h(HeroBadge, { label: 'v' + VERSION, color: '#374151' })
      ),
      h('h1', { class: 'text-4xl md:text-5xl font-bold text-white mb-4' }, PLATFORM_NAME),
      h('p', { class: 'text-lg text-gray-300 max-w-2xl mx-auto mb-8' }, DESCRIPTION),
      h('a', {
        href: GITHUB_URL,
        target: '_blank',
        rel: 'noopener',
        class: 'inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-3 rounded-lg transition-colors'
      },
        'View on GitHub'
      )
    )
  );
}

function FeatureCard({ title, desc }) {
  return h('div', { class: 'card-hover bg-gray-900 border border-gray-800 rounded-xl p-5' },
    h('h3', { class: 'font-semibold text-white mb-2' }, title),
    h('p', { class: 'text-gray-400 text-sm leading-relaxed' }, desc)
  );
}

function FeaturesSection() {
  return h('section', { class: 'py-16 px-4' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-8 text-center' }, 'Features'),
      h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' },
        ...FEATURES.map(f => h(FeatureCard, { title: f.title, desc: f.desc }))
      )
    )
  );
}

function InstallStep({ step, index }) {
  return h('div', { class: 'flex gap-4 items-start' },
    h('div', { class: 'flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white' },
      String(index + 1)
    ),
    h('div', { class: 'flex-1' },
      h('p', { class: 'text-gray-300 text-sm mb-1' }, step.desc),
      step.cmd ? h('pre', { class: 'bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-sm text-green-400 overflow-x-auto mt-1' },
        step.cmd
      ) : null
    )
  );
}

function InstallSection() {
  return h('section', { class: 'py-16 px-4 bg-gray-900/50' },
    h('div', { class: 'max-w-2xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-8 text-center' }, 'Installation'),
      h('div', { class: 'space-y-6' },
        ...INSTALL_STEPS.map((step, i) => h(InstallStep, { step, index: i }))
      )
    )
  );
}

function Footer() {
  return h('footer', { class: 'border-t border-gray-800 py-8 px-4 text-center text-gray-500 text-sm' },
    h('p', null,
      'Generated by ',
      h('a', { href: 'https://github.com/AnEntrypoint/plugforge', class: 'text-indigo-400 hover:text-indigo-300' }, 'plugforge'),
      ' — convention-driven multi-platform plugin generator'
    )
  );
}

function PlatformLink({ p }) {
  const isCurrent = p.id === CURRENT_PLATFORM;
  return h('a', {
    href: isCurrent ? '#' : \`https://AnEntrypoint.github.io/\${p.id}\`,
    class: \`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors \${isCurrent ? 'bg-indigo-600 text-white cursor-default' : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'}\`
  }, p.label);
}

function AlsoAvailableSection() {
  const cli = ALL_PLATFORMS.filter(p => p.type === 'cli');
  const ide = ALL_PLATFORMS.filter(p => p.type === 'ide');
  return h('section', { class: 'py-16 px-4 bg-gray-900/30' },
    h('div', { class: 'max-w-5xl mx-auto' },
      h('h2', { class: 'text-2xl font-bold text-white mb-8 text-center' }, 'Also Available For'),
      h('div', { class: 'space-y-6' },
        h('div', null,
          h('p', { class: 'text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3' }, 'CLI Tools'),
          h('div', { class: 'flex flex-wrap gap-2' }, ...cli.map(p => h(PlatformLink, { p, key: p.id })))
        ),
        h('div', null,
          h('p', { class: 'text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3' }, 'IDE Extensions'),
          h('div', { class: 'flex flex-wrap gap-2' }, ...ide.map(p => h(PlatformLink, { p, key: p.id })))
        )
      ),
      h('div', { class: 'mt-8 text-center' },
        h('a', { href: 'https://AnEntrypoint.github.io/plugforge', class: 'text-sm text-gray-400 hover:text-indigo-300 transition-colors' },
          '← Back to plugforge hub'
        )
      )
    )
  );
}

function App() {
  return h(Fragment, null,
    h(NavBar, null),
    h(Hero, null),
    h(FeaturesSection, null),
    h(InstallSection, null),
    h(AlsoAvailableSection, null),
    h(Footer, null)
  );
}

applyDiff(document.body, [h(App, null)]);
</script>
</body>
</html>`;
  }
}

module.exports = TemplateBuilder;
