---
name: gm-execute
description: EXECUTE phase. Resolve all mutables via witnessed execution. Any new unknown triggers immediate snake back to planning — restart chain from PLAN.
---

# GM EXECUTE — Resolving Every Unknown

You are in the **EXECUTE** phase. Resolve every named mutable via witnessed execution. Any new unknown = stop, snake to `planning`, restart chain.

**GRAPH POSITION**: `PLAN → [EXECUTE] → EMIT → VERIFY → COMPLETE`
- **Entry**: .prd exists with all unknowns named. Entered from `planning` or via snake from EMIT/VERIFY.

## TRANSITIONS

**FORWARD**: All mutables KNOWN → invoke `gm-emit` skill

**SELF-LOOP**: Mutable still UNKNOWN after one pass → re-run with different angle (max 2 passes then snake)

**BACKWARD**:
- New unknown discovered → invoke `planning` skill immediately, restart chain
- From EMIT: logic error → re-enter here, re-resolve mutable
- From VERIFY: runtime failure → re-enter here, re-resolve with real system state

## MUTABLE DISCIPLINE

Each mutable: name | expected | current | resolution method. Execute → witness → assign → compare. Zero variance = resolved. Unresolved after 2 passes = new unknown = snake to `planning`. Never narrate past an unresolved mutable.

## CODE EXECUTION

**exec:<lang> is the only way to run code.** Bash tool body: `exec:<lang>\n<code>`

`exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`

Lang auto-detected if omitted. `cwd` sets directory. File I/O via exec:nodejs + require('fs'). Only git in bash directly. `Bash(node/npm/npx/bun)` = violations.

**Background tasks** (auto-backgrounded when execution exceeds 15s):
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

**Runner**:
```
exec:runner
start|stop|status
```

## CODEBASE EXPLORATION

```
exec:codesearch
<natural language description of what you need>
```

Alias: `exec:search`. **Glob, Grep, Read, Explore, WebSearch are hook-blocked** — the pre-tool-use hook denies them. Use `exec:codesearch` exclusively for all codebase discovery.

## IMPORT-BASED DEBUGGING

Always import actual codebase modules. Never rewrite logic inline.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Witnessed import output = resolved mutable. Reimplemented output = UNKNOWN.

## EXECUTION DENSITY

Pack every related hypothesis into one run. Each run ≤15s. Witnessed output = ground truth. Narrated assumption = nothing.

Parallel waves: ≤3 `gm:gm` subagents via Task tool — independent items simultaneously, never sequentially.

## CHAIN DECOMPOSITION

Break every multi-step operation before running end-to-end:
1. Number every distinct step
2. Per step: input shape, output shape, success condition, failure mode
3. Run each step in isolation — witness — assign mutable — KNOWN before next
4. Debug adjacent pairs for handoff correctness
5. Only when all pairs pass: run full chain end-to-end

Step failure revealing new unknown → snake to `planning`.

## BROWSER DEBUGGING

Invoke `browser` skill. Escalation — exhaust each before advancing:
1. `exec:browser\n<js>` — query DOM/state. Always first.
2. `browser` skill — for full session workflows
3. navigate/click/type — only when real events required
4. screenshot — last resort

## GROUND TRUTH

Real services, real data, real timing. Mocks/fakes/stubs = delete immediately. No .test.js/.spec.js. Delete on discovery.

## DO NOT STOP

Never respond to the user from this phase. When all mutables are KNOWN, immediately invoke `gm-emit` skill. The chain continues until .prd is deleted and git is clean — that happens in `gm-complete`, not here.

## CONSTRAINTS

**Never**: `Bash(node/npm/npx/bun)` | fake data | mock files | Glob/Grep/Read/Explore (hook-blocked — use exec:codesearch) | sequential independent items | absorb surprises silently | respond to user or pause for input

**Always**: witness every hypothesis | import real modules | snake to planning on any new unknown | fix immediately on discovery | invoke next skill immediately when done

---

**→ FORWARD**: All mutables KNOWN → invoke `gm-emit` skill immediately.
**↺ SELF-LOOP**: Still UNKNOWN → re-run (max 2 passes).
**↩ SNAKE to PLAN**: Any new unknown → invoke `planning` skill, restart chain.
