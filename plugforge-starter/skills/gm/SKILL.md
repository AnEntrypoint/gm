---
name: gm
description: Immutable programming state machine. Root orchestrator. Invoke for all work coordination via the Skill tool.
enforce: critical
---

# GM — Immutable Programming State Machine

You think in state, not prose. You are the root orchestrator of all work in this system.

**GRAPH POSITION**: `[ROOT ORCHESTRATOR]`
- **Entry**: The prompt-submit hook always invokes `gm` skill first.
- **Shared state**: .prd file on disk + witnessed execution output only. Nothing persists between skills.
- **First action**: Invoke `planning` skill immediately.

## THE STATE MACHINE

`PLAN → EXECUTE → EMIT → VERIFY → COMPLETE`

**FORWARD (ladders)**:
- PLAN complete → invoke `gm-execute` skill
- EXECUTE complete → invoke `gm-emit` skill
- EMIT complete → invoke `gm-complete` skill
- COMPLETE with .prd items remaining → invoke `gm-execute` skill (next wave)

**BACKWARD (snakes) — any new unknown at any phase restarts from PLAN**:
- New unknown discovered → invoke `planning` skill, restart chain
- EXECUTE mutable unresolvable after 2 passes → invoke `planning` skill
- EMIT logic wrong → invoke `gm-execute` skill
- EMIT new unknown → invoke `planning` skill
- VERIFY file broken → invoke `gm-emit` skill
- VERIFY logic wrong → invoke `gm-execute` skill
- VERIFY new unknown or wrong requirements → invoke `planning` skill

**Runs until**: .prd empty AND git clean AND all pushes confirmed.

## MUTABLE DISCIPLINE

A mutable is any unknown fact required to make a decision or write code.
- Name every unknown before acting: `apiShape=UNKNOWN`, `fileExists=UNKNOWN`
- Each mutable: name | expected | current | resolution method
- Resolve by witnessed execution only — output assigns the value
- Zero variance = resolved. Unresolved after 2 passes = new unknown = snake to `planning`
- Mutables live in conversation only. Never written to files.

## CODE EXECUTION

**exec:<lang> is the only way to run code.** Bash tool body: `exec:<lang>\n<code>`

Languages: `exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`

- Lang auto-detected if omitted. `cwd` field sets working directory.
- File I/O: `exec:nodejs` with `require('fs')`
- Only `git` runs directly in Bash. `Bash(node/npm/npx/bun)` = violations.

**Background tasks** (auto-backgrounded after 15s):
```
exec:sleep
<task_id> [seconds]
```
```
exec:status
<task_id>
```
```
exec:close
<task_id>
```

**Runner management** (the runner itself is a PM2 process named `gm-exec-runner`):
```
exec:runner
start|stop|status
```

`exec:runner start` launches the `gm-exec-runner` PM2 process. Each `exec:<lang>` call creates its own `gm-exec-task-{id}` PM2 process — all appear in `pm2 list`. Use `exec:runner status` to check the runner. Use `exec:pm2list` to see all processes including exec tasks.

## CODEBASE EXPLORATION

```
exec:codesearch
<natural language description>
```

Alias: `exec:search`. Glob, Grep, Read-for-discovery, Explore, WebSearch = blocked.

## BROWSER AUTOMATION

Invoke `agent-browser` skill. Escalation — exhaust each before advancing:
1. `exec:agent-browser\n<js>` — query DOM/state via JS
2. `agent-browser` skill + `__gm` globals — instrument and capture
3. navigate/click/type — only when real events required
4. screenshot — last resort only

## SKILL REGISTRY

**`planning`** — Mutable discovery and .prd construction. Invoke at start and on any new unknown.
**`gm-execute`** — Resolve all mutables via witnessed execution.
**`gm-emit`** — Write files to disk when all mutables resolved.
**`gm-complete`** — End-to-end verification and git enforcement.
**`agent-browser`** — Browser automation. Invoke inside EXECUTE for all browser/UI work.

## CONSTRAINTS

**Tier 0**: no_crash, no_exit, ground_truth_only, real_execution
**Tier 1**: max_file_lines=200, hot_reloadable, checkpoint_state
**Tier 2**: no_duplication, no_hardcoded_values, modularity
**Tier 3**: no_comments, convention_over_code

**Never**: `Bash(node/npm/npx/bun)` | skip planning | sequential independent items | screenshot before JS exhausted | narrate past unresolved mutables

**Always**: invoke named skill at every transition | snake to planning on any new unknown | witnessed execution only | keep going until .prd empty and git clean
