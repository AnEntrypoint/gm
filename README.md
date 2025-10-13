# WFGY Enhanced Claude Code Plugin

An advanced Claude Code plugin that provides comprehensive automated workflows, WFGY integration, and bundled MCP tools for enhanced development productivity.

## Structure

- `claude-plugin.json` - Main plugin configuration with advanced hooks and bundled MCP servers
- `context/work-guidelines.md` - Work guidelines loaded on user prompts
- `context/cleanup-guidelines.md` - Cleanup guidelines loaded on session stop

## Installation

1. Copy the plugin files to your desired location
2. Load the plugin in Claude Code settings
3. MCP tools are automatically bundled and available

## Features

### Automated Hooks
- **UserPromptSubmit**: Automatically loads work guidelines and runs WFGY hook on every user prompt
- **Stop**: Automatically runs cleanup guidelines and WFGY hook when session stops
- **SessionStart**: Automatically initializes MCP thorns when session begins
- **PreToolUse**: Shows notifications before Write/Edit/Bash operations
- **PostToolUse**: Confirms completion of Write/Edit/Bash operations
- **SessionEnd**: Automatically saves WFGY context on session end

### Bundled MCP Tools
- **glootie** - Code execution and testing via `mcp-glootie@latest`
- **vexify** - Code search and AST analysis via `vexify@latest`
- **playwright** - Browser automation and testing via `@playwright/mcp@latest`
- **mcp-thorns** - WFGY integration (loaded via hooks)

### Comprehensive Permissions
Full tool access including:
- **Core Tools**: Read, Write, Edit, Bash, Task, WebFetch, Glob, Grep, TodoWrite
- **MCP Tools**: glootie (execute, ast_tool, caveat), playwright (browser automation), vexify (search_code)

### Plugin Settings
- **autoSave**: Enabled for automatic saving
- **compactOnStop**: Disabled to preserve context
- **notificationTimeout**: 5 seconds
- **debugMode**: Disabled for production use

## Workflow Automation

The plugin provides fully automated workflows:

1. **Session Start**: Initializes WFGY and MCP tools
2. **During Work**: Provides guidance and notifications for all operations
3. **Session End**: Saves context and runs cleanup procedures

No manual command invocation needed - everything runs automatically through hooks.

## Version
**v2.0.0** - Enhanced with advanced hooks and comprehensive MCP integration