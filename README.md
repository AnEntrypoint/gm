# Glootius Maximus (gm)

A comprehensive Claude Code plugin that enhances your development workflow with advanced code execution, semantic search, and automated state machine enforcement. This plugin provides a robust environment for writing, testing, and deploying code with built-in recovery mechanisms and hot-reload support.

## Quick Start

### Installation

```bash
# Add the plugin marketplace
claude plugin marketplace add AnEntrypoint/gm

# Install the plugin
claude plugin install -s user gm@gm

# Update the plugin (when needed)
claude plugin marketplace update gm
claude plugin update gm@gm
```

### Usage

The plugin integrates automatically into your workflow. For best results, include `gm everything` in your prompts to ensure the specialized agent is always invoked.

**Core workflow**: Plan → Execute in dev/playwright → Verify → Complete

The agent enforces code execution before file edits, ensuring all hypotheses are tested before modification.

---

## What is GM?

GM (Glootius Maximus) is a programming agent state machine that enforces a systematic, disciplined approach to software development. It operates as a virtual state machine that the LLM must emulate, with immutable rules and inescapable constraints.

### Core Principles

1. **Completion is Absolute** - Partial work means nothing. The last 1% is 99% of the work.
2. **Execute Before Edit** - Every hypothesis must be proven before any file is modified.
3. **Search When Unknown** - Use web search to find solutions before implementing.
4. **Exhaustive Execution** - Test every possible path, failure mode, and recovery scenario.
5. **Output is Computation** - Code does work and returns results. No documentation instead of execution.
6. **Real Data Only** - Never use mocks, fakes, or stubs. Always use actual services and data.

### What's Forbidden

- ❌ Shell commands inside code
- ❌ Process spawning (spawn, exec, fork, child_process)
- ❌ Polling with setTimeout/setInterval
- ❌ Heredocs and pipes
- ❌ File creation via dev or playwright
- ❌ Mocks, fakes, stubs, fixtures, or simulations
- ❌ Crash as a solution
- ❌ "Remaining steps for user" as completion

---

## How It Works

### The State Machine

GM follows a strict development cycle:

```
Search → Plan → Hypothesize → Execute → Measure → Gate → Emit → Verify → Complete
```

If any step fails, the process returns to the Plan phase.

### Gate Conditions

The **Gate** blocks completion until all conditions are satisfied:

- ✅ Executed in dev or playwright
- ✅ Goal achieved (not just "ready")
- ✅ Output is real results (no mocks)
- ✅ Hot reload supported
- ✅ Recovery paths exist
- ✅ Cleanup complete
- ✅ Debug hooks exposed

### Execution Environments

| Environment | Purpose |
|-------------|---------|
| **dev** (`plugin:gm:dev`) | CLI runtime for code execution in any language, read-only exploration (ls, find, cat, git status, git log, git diff) |
| **playwright** | Browser automation—executes code in a live browser session. Requires the [playwright browser plugin](https://github.com/remorses/playwriter) |
| **code-search** | Finds patterns, conventions, architecture, and similar features in the codebase |
| **write** | The only method for file mutation. All production code goes through the write tool. |

### MCP Tools Integration

The plugin's MCP tools appear under the `gm` plugin namespace:

```
plugin:gm:dev        # Code execution environment
plugin:gm:code-search # Semantic code search
```

---

## Features

### Bundled Tools

| Tool | Description | Source |
|------|-------------|--------|
| **Glootie** | Code execution environment via `mcp-glootie@latest` | [AnEntrypoint/mcp-glootie](https://github.com/AnEntrypoint/mcp-glootie) |
| **Code Search** | Semantic code search for patterns, conventions, and architecture | [AnEntrypoint/code-search](https://github.com/AnEntrypoint/code-search) |
| **Thorns** | Additional utilities loaded via hooks | Built-in |

### Key Capabilities

- **Code Execution First**: All hypotheses must be proven in `dev` or `playwright` before any file is modified
- **Semantic Search**: Find patterns, conventions, and similar features across your codebase
- **State Machine Enforcement**: The plugin enforces a systematic approach to development
- **Hot Reload Support**: Systems are designed to reload without restart, preserving connections and state
- **Self-Recovering**: Built-in recovery mechanisms prevent crashes and ensure uptime
- **Real Data Only**: No mocks, fakes, or stubs—all verification uses actual services and data

---

## Architecture

### Hooks

The plugin includes automated hooks that enhance workflow:

| Hook | Purpose |
|------|---------|
| `session-start-hook.js` | Runs when a Claude Code session starts |
| `stop-hook.js` | Runs when a session ends, handles cleanup |
| `stop-hook-git.js` | Git-specific cleanup and consolidation |
| `prompt-submit-hook.js` | Runs before prompts are submitted |
| `pre-tool-use-hook.js` | Runs before tools are invoked |

Hooks are configured in `hooks/hooks.json` and can be customized to fit your workflow.

### GXE Proxy

The plugin uses **gxe** as an npx-to-github proxy to:
- Start tools faster
- Keep dependencies up-to-date
- Simplify installation

If you encounter issues with partial installs, simply delete `~/.gxe` and reinstall.

### No Orchestration in Code

The plugin enforces a strict policy: **no shell commands, process orchestration, or file creation via execution tools**. This ensures:
- Clean separation between code execution and file management
- Prevents race conditions and orphaned processes
- Makes recovery and hot reload possible

### Immortal Systems Design

Systems built with this plugin are designed to:
- **Recover**: From any failure state
- **Reload**: Without restart or downtime
- **Continue**: Through interruptions and errors
- **Survive**: Forever—infinite uptime by design

---

## Troubleshooting

### Plugin not working?

1. Ensure the plugin is installed:
   ```bash
   claude plugin list
   ```

2. Check that hooks are loaded in `hooks/hooks.json`

3. Try adding `gm everything` to your prompt to ensure the agent is invoked

4. For browser automation, ensure the [playwright browser plugin](https://github.com/remorses/playwriter) is installed and activated

### Partial or broken installation?

Delete the gxe cache and reinstall:
```bash
rm -rf ~/.gxe
claude plugin marketplace update gm
claude plugin update gm@gm
```

### Hooks not firing?

Check `hooks/hooks.json` to ensure hooks are properly configured. You can test hooks manually by running the hook files directly with Node.js.

---

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT

## Author

**AnEntrypoint** - [GitHub](https://github.com/AnEntrypoint)

---

<!-- Stop hook test: 2026-01-13 -->
