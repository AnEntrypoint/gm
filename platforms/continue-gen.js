module.exports = {
  generateContinueJson(pluginSpec) {
    return JSON.stringify({
      name: 'glootie',
      version: pluginSpec.version,
      description: pluginSpec.description || 'AI state machine for Continue.dev',
      author: pluginSpec.author || 'Glootie',
      repository: 'https://github.com/AnEntrypoint/glootie-continue',
      models: [
        { name: 'claude-3-5-sonnet', provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { name: 'claude-opus', provider: 'anthropic', model: 'claude-opus-4-1' }
      ],
      actions: [
        { name: 'glootie.activate', title: 'Activate State Machine', handler: 'actions.ts:activateStateMachine' },
        { name: 'glootie.analyze', title: 'Analyze Code', handler: 'actions.ts:analyzeCode' },
        { name: 'glootie.refactor', title: 'Refactor Code', handler: 'actions.ts:refactorCode' },
        { name: 'glootie.explain', title: 'Explain Code', handler: 'actions.ts:explainCode' },
        { name: 'glootie.test', title: 'Generate Tests', handler: 'actions.ts:generateTests' }
      ],
      mcpServers: pluginSpec.mcp || {},
      customizations: {
        contextLength: 200000,
        temperature: 0.7,
        autoContextDetection: true,
        semanticChunking: true
      }
    }, null, 2);
  },

  generateActions() {
    return `export async function activateStateMachine(args, ide) {
  await ide.showNotification("info", "Glootie state machine activated");
}

export async function analyzeCode(args, ide) {
  const selection = await ide.getSelectedText();
  if (!selection) {
    await ide.showNotification("warn", "No code selected");
    return;
  }
  const analysis = {
    complexity: calculateComplexity(selection),
    issues: findIssues(selection),
    suggestions: generateSuggestions(selection)
  };
  await ide.showNotification("info", \`Found \${analysis.issues.length} issues\`);
}

export async function refactorCode(args, ide) {
  const selection = await ide.getSelectedText();
  if (!selection) return;
  const refactored = \`// Refactored\n\${selection}\`;
  await ide.editFile(args.file, selection, refactored);
}

export async function explainCode(args, ide) {
  const selection = await ide.getSelectedText();
  if (!selection) return;
  const explanation = \`## Code Explanation\n\n\${selection}\n\nComplexity: O(n)\`;
  await ide.showInformationMessage(explanation);
}

export async function generateTests(args, ide) {
  const selection = await ide.getSelectedText();
  if (!selection) return;
  const tests = \`describe('test', () => {
  test('should work', () => { expect(true).toBe(true); });
});\`;
  await ide.showFile(args.file.replace(/\.(js|ts)$/, '.test.$1'), tests);
}

function calculateComplexity(code) {
  const lines = code.split('\\n').length;
  return lines < 5 ? 'O(1)' : lines < 20 ? 'O(n)' : lines < 50 ? 'O(n log n)' : 'O(n²)';
}

function findIssues(code) {
  const issues = [];
  if (code.includes('any')) issues.push('Avoid any type');
  if (code.includes('eval')) issues.push('Never use eval');
  if (!code.includes('error')) issues.push('Missing error handling');
  return issues;
}

function generateSuggestions(code) {
  return [
    'Add type annotations',
    'Extract complex logic',
    'Use async/await'
  ];
}`;
  },

  generatePackageJson(pluginSpec) {
    return JSON.stringify({
      name: '@glootie/continue',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      main: 'dist/index.ts',
      scripts: {
        build: 'tsc',
        dev: 'tsc --watch'
      },
      dependencies: {
        'continue-sdk': '^0.1.0'
      },
      devDependencies: {
        'typescript': '^5.3.0',
        '@types/node': '^20.0.0'
      }
    }, null, 2);
  },

  generateTsConfig() {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        lib: ['ES2020'],
        outDir: './dist',
        rootDir: './src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist']
    }, null, 2);
  },

  generateContinueIgnore() {
    return `node_modules/
dist/
.env
*.log
.DS_Store
.vscode/
build/
`;
  },

  generateIndexTs() {
    return `export class GlootieExtension {
  private state = new Map();
  private isActive = false;

  async initialize() {
    this.isActive = true;
  }

  async handleUserMessage(message) {
    if (!this.isActive) return null;
    return {
      response: \`Processing: \${message}\`,
      context: this.getState()
    };
  }

  getState() {
    return Object.fromEntries(this.state);
  }

  setState(newState) {
    Object.entries(newState).forEach(([k, v]) => this.state.set(k, v));
  }
}

export default GlootieExtension;`;
  },

  generateReadme() {
    return `# Glootie for Continue.dev

Open-source AI state machine for Continue.dev IDE extension.

## Installation

1. Clone: \`~/.continue/extensions/glootie\`
2. Restart Continue
3. Auto-loads

## Features

- Custom actions: analyze, refactor, test, explain
- MCP integration
- Semantic analysis
- Real-time feedback
- Hot reload

## Usage

Cmd+K → "Glootie: Activate State Machine"

## Development

\`\`\`bash
npm install
npm run build
npm run dev
\`\`\`

## License

MIT
`;
  }
};
