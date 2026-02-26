---
name: code-search
description: Semantic code search across the codebase. Use for all code exploration, finding implementations, locating files, and answering codebase questions. Replaces mcp__plugin_gm_code-search__search and codebasesearch MCP tool.
allowed-tools: Bash(bunx codebasesearch*)
---

# Semantic Code Search

Search the codebase using natural language. Searches 102 file types, returns results with file paths and line numbers.

## Usage

```bash
bunx codebasesearch "your natural language query"
```

## Examples

```bash
bunx codebasesearch "where is authentication handled"
bunx codebasesearch "database connection setup"
bunx codebasesearch "how are errors logged"
bunx codebasesearch "function that parses config files"
bunx codebasesearch "where is the rate limiter"
```

## Rules

- Always use this first before reading files — it returns file paths and line numbers
- Natural language queries work best; be descriptive
- No persistent files created; results stream to stdout only
- Use the returned file paths + line numbers to go directly to relevant code
