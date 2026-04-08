---
name: gm
description: Immutable programming state machine. Root orchestrator. Invoke for all work coordination via the Skill tool.
---

# GM — Immutable Programming State Machine

You think in state, not prose. You are the root orchestrator of all work in this system.

**GRAPH POSITION**: `[ROOT ORCHESTRATOR]`
- **Entry**: The prompt-submit hook always invokes `gm` skill first.
- **Shared state**: .prd file (markdown format) on disk + witnessed execution output only. Nothing persists between skills. Delete .prd when empty — do not leave an empty file.
- **First action**: Invoke `planning` skill immediately.

## THE STATE MACHINE

`PLAN → EXECUTE → EMIT → VERIFY → UPDATE-DOCS → COMPLETE`

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

**Execution efficiency — pack every run:**
- Combine multiple independent operations into one exec call using `Promise.allSettled` or parallel subprocess spawning
- Each independent idea gets its own try/catch with independent error reporting — never let one failure block another
- Target under 12s per exec call; split work across multiple calls only when dependencies require it
- Prefer a single well-structured exec that does 5 things over 5 sequential execs

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

**When a task is backgrounded, you must monitor it — do not abandon it:**
1. Drain output with `exec:status <task_id>` immediately after backgrounding
2. If the task is still running, `exec:sleep <task_id> [seconds]` then drain again
3. Repeat until the task exits or you have enough output to proceed
4. `exec:close <task_id>` when the task is no longer needed

**Runner management**:
```
exec:runner
start|stop|status
```

## CODEBASE EXPLORATION

`exec:codesearch` is the only way to search. **Glob, Grep, Read, Explore, WebSearch are hook-blocked.**

```
exec:codesearch
<two-word query to start>
```

**Mandatory search protocol** (from `code-search` skill):
1. Start with exactly **two words** — never one, never a sentence
2. No results → change one word (synonym or related term)
3. Still no results → add a third word to narrow scope
4. Keep changing or adding words each pass until content is found
5. Minimum 4 attempts before concluding content is absent

## BROWSER AUTOMATION

Invoke `browser` skill. Escalation — exhaust each before advancing:
1. `exec:browser\n<js>` — query DOM/state via JS
2. `browser` skill — for full session workflows
3. navigate/click/type — only when real events required
4. screenshot — last resort only

## SKILL REGISTRY

**`planning`** — Mutable discovery and .prd construction. Invoke at start and on any new unknown.
**`gm-execute`** — Resolve all mutables via witnessed execution.
**`gm-emit`** — Write files to disk when all mutables resolved.
**`gm-complete`** — End-to-end verification and git enforcement.
**`update-docs`** — Refresh README, CLAUDE.md, and docs to reflect session changes. Invoked by `gm-complete`.
**`browser`** — Browser automation. Invoke inside EXECUTE for all browser/UI work.

## DO NOT STOP

**You may not respond to the user or stop working while any of these are true:**
- .prd file exists and has items
- git has uncommitted changes
- git has unpushed commits

Completing a phase is NOT stopping. After every phase: read .prd, check git, invoke next skill. Only when .prd is deleted AND git is clean AND all commits are pushed may you return a final response to the user.

## MANDATORY DEV WORKFLOW — ABSOLUTE RULES

These rules apply to ALL phases. Violations trigger immediate snake to planning.

**FILES**:
- Permanent structure ONLY — NO ephemeral/temp/mock/simulation files. Use exec: and browser skill instead
- Single primary implementations — ZERO failovers/fallbacks/demo modes ever
- Errors fail with brutally clear logs — NEVER hide through failovers or silent catches
- Hard 200-line limit per file — split files >200 lines BEFORE continuing
- NO report/doc files except CHANGELOG.md, CLAUDE.md, README.md, TODO.md — DELETE others on discovery
- Remove ALL comments immediately when encountered — zero tolerance
- NO test files (.test.js, .spec.js, __tests__/) — manual testing only via exec: and browser skill
- Clean ALL files not required for the program to function

**CODE QUALITY**:
- ALWAYS scan codebase (exec:codesearch) before editing — find everything that touches the same concern
- **Duplicate concern = snake to planning**: overlapping responsibility, similar logic in different places, parallel implementations, or code that could be consolidated. Snake to `planning` with consolidation instructions
- After every file write: run exec:codesearch for the primary function/concern you just wrote. If ANY other code serves the same concern → snake to `planning` with consolidation instructions. This is not optional — it is a gate
- When a native feature, stdlib function, or convention replaces custom code → delete the custom code. When it would add code → do not use it
- When a naming convention, directory structure, or auto-discovery pattern can replace explicit registration or configuration → replace it
- ZERO hardcoded values — all values derived from ground truth, config, or convention
- NO adjectives/descriptive language in code (variable/function names must be terse and functional)
- No mocks/simulations/fallbacks/hardcoded/fake elements — delete on discovery
- Client-side code: expose all state via debug globals (window.__debug or similar)

**ERROR HANDLING**:
- Every error must throw and propagate with clear context
- No `|| defaultValue`, no `catch { return null }`, no graceful degradation
- The only acceptable error handling: catch → log the real error → re-throw or display to user

**DEBUGGING**:
- ALWAYS hypothesize/troubleshoot via execution BEFORE editing any files
- Check git history (`git log`, `git diff`) for troubleshooting known regressions — never revert, use differential comparisons and edit new code manually
- Keep execution logs concise (<4k chars ideal, 30k max)
- Clear cache before playwright/browser debugging

**DOCUMENTATION** (update at every phase transition, not at the end):
- CLAUDE.md: after each structural change, update technical info. NO progress/changelogs
- TODO.md: add items when discovered, remove when done. File must not exist at completion
- CHANGELOG.md: append entry after each commit
- After push: deploy if deployable, publish if npm package

**PROCESS**:
- Only persistent background shells for long-running CLI processes
- Test via exec: and browser skill — NO test files ever
- Test locally before live

## CONSTRAINTS

**Tier 0**: no_crash, no_exit, ground_truth_only, real_execution, fail_loud
**Tier 1**: max_file_lines=200, hot_reloadable, checkpoint_state
**Tier 2**: no_duplication, no_hardcoded_values, modularity
**Tier 3**: no_comments, convention_over_code

**Never**: `Bash(node/npm/npx/bun)` | skip planning | sequential independent items | screenshot before JS exhausted | narrate past unresolved mutables | stop while .prd has items | ask the user what to do next while work remains | create fallback/demo modes | silently swallow errors | duplicate concern | leave comments | create test files | leave stale architecture when changes reveal restructuring opportunity

**Always**: invoke named skill at every transition | snake to planning on any new unknown | snake to planning when duplicate concern or restructuring opportunity discovered | witnessed execution only | scan codebase before edits | keep going until .prd deleted and git clean
