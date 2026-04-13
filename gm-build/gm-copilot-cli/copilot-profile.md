---
name: gm
version: 2.0.456
description: State machine agent with hooks, skills, and automated git enforcement
author: AnEntrypoint
repository: https://github.com/AnEntrypoint/gm-copilot-cli
license: MIT
capabilities:
  - code_analysis
  - semantic_search
  - autonomous_execution
  - state_management
activation:
  trigger: prompt_start
  auto_activate: true
  context_window: 200000
models:
  - claude-3-5-sonnet
  - claude-opus-4-1
---

# GM State Machine Agent

Autonomous AI-powered state machine for GitHub Copilot CLI.

## Features

- State machine with checkpointing
- Autonomous actions
- MCP integration
- Hot reload
- Real-time execution

## Activation

Auto-activates on prompt submission.

## Tools

- `shell` - Execute commands
- `file_write` - Create/modify files
- `file_glob` - Find files
- `file_search` - Search files
- `semantic_search` - AI search

## State Management

State in `~/.gh/extensions/gm/state.json`.

## Configuration

`~/.copilot/config.json`:

```json
{
  "gm": {
    "enabled": true,
    "auto_activate": true,
    "log_level": "info"
  }
}
```

## Example Usage

```bash
gh copilot run "analyze code complexity"
gh copilot run "refactor component"
gh copilot run "generate tests"
```
