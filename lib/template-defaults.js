const HOOK_SKELETONS = {
  'session-start': `const sessionStart = async (context) => {
  try {
    console.log('Session started');
  } catch (error) {
    console.error('session-start error:', error);
  }
};

module.exports = sessionStart;`,

  'pre-tool': `const preTool = async (context) => {
  try {
    const { tool, args } = context;
    console.log('Before tool:', tool);
  } catch (error) {
    console.error('pre-tool error:', error);
  }
};

module.exports = preTool;`,

  'prompt-submit': `const promptSubmit = async (context) => {
  try {
    const { prompt, history } = context;
    console.log('Prompt submitted');
  } catch (error) {
    console.error('prompt-submit error:', error);
  }
};

module.exports = promptSubmit;`,

  'stop': `const stop = async (context) => {
  try {
    console.log('Stopping plugin');
  } catch (error) {
    console.error('stop error:', error);
  }
};

module.exports = stop;`,

  'stop-git': `const stopGit = async (context) => {
  try {
    console.log('Git cleanup on stop');
  } catch (error) {
    console.error('stop-git error:', error);
  }
};

module.exports = stopGit;`
};

const AGENT_SKELETONS = {
  gm: `# GM State Machine Agent

You are the gm agent - a state machine orchestrator for the glootie system.

## Purpose

Execute operations through defined state transitions with proper lifecycle management.

## Key Responsibilities

- Track system state
- Execute atomic operations
- Manage transitions
- Handle recovery

## Capabilities

- State inspection
- Transition execution
- Recovery coordination`,

  codesearch: `# Code Search Agent

You are the codesearch agent - specialized in semantic and syntactic code analysis.

## Purpose

Search and analyze code patterns across repositories.

## Key Responsibilities

- Semantic pattern matching
- Cross-file correlation
- Architecture discovery
- Refactoring identification`,

  websearch: `# Web Search Agent

You are the websearch agent - specialized in gathering online information.

## Purpose

Research and aggregate web-based information.

## Key Responsibilities

- Real-time information gathering
- Source verification
- Relevance ranking
- Citation management`
};

const PLATFORM_CONFIGS = {
  cc: { contextFile: '.claude-code-context', configFile: '.claude-code-config.json' },
  gc: { contextFile: '.gemini-cli-context', configFile: '.gemini-cli-config.json' },
  oc: { contextFile: '.opencode-context', configFile: '.opencode-config.json' },
  vscode: { contextFile: 'package.json', configFile: 'tsconfig.json' },
  cursor: { contextFile: 'package.json', configFile: 'tsconfig.json' },
  zed: { contextFile: 'Cargo.toml', configFile: 'Cargo.toml' },
  jetbrains: { contextFile: 'build.gradle.kts', configFile: 'build.gradle.kts' },
  copilot: { contextFile: 'package.json', configFile: 'tsconfig.json' }
};

const README_TEMPLATE = (name, desc) => `# ${name}

${desc}

## Installation

\`\`\`bash
npm install ${name}
\`\`\`

## Features

- Convention-driven architecture
- Zero configuration required
- Multi-platform support
- Hot reload ready

## Agents

- gm: State machine agent
- codesearch: Code search capabilities
- websearch: Web search integration

## Hooks

- session-start: Initializes on session start
- pre-tool: Runs before tool execution
- prompt-submit: Runs on prompt submission
- stop: Cleanup on stop
- stop-git: Git cleanup on stop

## License

MIT`;

const GITIGNORE = `node_modules/
*.log
.DS_Store
dist/
build/
.env
.env.local
.glootie-stop-verified
coverage/`;

module.exports = {
  HOOK_SKELETONS,
  AGENT_SKELETONS,
  PLATFORM_CONFIGS,
  README_TEMPLATE,
  GITIGNORE
};
