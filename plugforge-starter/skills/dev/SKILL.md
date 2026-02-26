---
name: dev
description: Execute code and shell commands. Use for all code execution, file operations, running scripts, testing hypotheses, and any task that requires running code. Replaces plugin:gm:dev and mcp-glootie.
allowed-tools: Bash
---

# Code Execution with dev

Execute code directly using the Bash tool. No wrapper, no persistent files, no cleanup needed beyond what the code itself creates.

## Run code inline

```bash
# JavaScript / TypeScript
bun -e "const fs = require('fs'); console.log(fs.readdirSync('.'))"
bun -e "import { readFileSync } from 'fs'; console.log(readFileSync('package.json', 'utf-8'))"

# Run a file
bun run script.ts
node script.js

# Python
python -c "import json; print(json.dumps({'ok': True}))"

# Shell
bash -c "ls -la && cat package.json"
```

## File operations (inline, no temp files)

```bash
# Read
bun -e "console.log(require('fs').readFileSync('path/to/file', 'utf-8'))"

# Write
bun -e "require('fs').writeFileSync('out.json', JSON.stringify({x:1}, null, 2))"

# Stat / exists
bun -e "const fs=require('fs'); console.log(fs.existsSync('file.txt'), fs.statSync?.('.')?.size)"
```

## Rules

- Each run under 15 seconds
- Pack every related hypothesis into one run — never one idea per run
- No persistent temp files; if a temp file is needed, delete it in the same command
- No spawn/exec/fork inside executed code
- Use `bun` over `node` when available
