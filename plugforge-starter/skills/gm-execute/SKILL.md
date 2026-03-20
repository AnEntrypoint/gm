---
name: gm-execute
description: EXECUTE phase. Hypothesis proving, chain decomposition, import-based debugging, browser protocols, ground truth enforcement. Invoke when entering EXECUTE or snaking back from EMIT/VERIFY.
---

# GM EXECUTE — Resolving Every Unknown

You are in the **EXECUTE** phase. Every mutable must resolve to KNOWN via witnessed execution before advancing.

**GRAPH POSITION**: `PLAN → [EXECUTE] → EMIT → VERIFY → COMPLETE`
- **Entry chain**: prompt-submit hook → `gm` skill → `planning` → `gm-execute` (here). Also entered via snake from EMIT or VERIFY.

## TRANSITIONS

**FORWARD (ladders)**:
- All mutables resolved to KNOWN → invoke `gm-emit` skill

**BACKWARD (snakes) — when to re-enter here**:
- From EMIT: pre-emit debugging reveals logic error, hypothesis was wrong → snake back, re-run execution with corrected approach
- From VERIFY: end-to-end debugging reveals runtime failure not caught in execution → snake back, re-execute with real system state
- Self-loop: mutables still UNKNOWN after a pass → re-invoke `gm-execute` with broader debug scope. Never add stages.

**WHEN TO SNAKE BACK TO PLAN instead**: discovered hidden dependencies that require .prd restructure → invoke `planning` skill

**Sub-skills** (invoke from within EXECUTE):
- Code exploration → invoke `code-search` skill
- Browser/UI debugging → invoke `agent-browser` skill
- Servers/workers/daemons → invoke `process-management` skill

## MUTABLE DISCIPLINE

Enumerate every unknown as a named mutable. Each: name, expected value, current value, resolution method. Execute → witness → assign → compare → zero variance = resolved. Unresolved = absolute barrier. Never narrate past an unresolved mutable. Trigger a snake if stuck.

## EXECUTION DENSITY

Each run ≤15s, packed with every related hypothesis. Group all related unknowns into one run. Never one idea per run. Witnessed output = ground truth. Narrated assumption = nothing.

**Parallel waves**: Launch ≤3 `gm:gm` subagents per wave via Task tool. Independent items simultaneously. Sequential execution of independent items = violation.

## CHAIN DECOMPOSITION

Break every multi-step operation before running end-to-end:
1. Number every distinct step (parse → validate → transform → write → confirm)
2. Per step: input shape, output shape, success condition, failure condition
3. Run step 1 in isolation → witness → assign mutable → proceed only when KNOWN
4. Run step 2 with step 1's witnessed output. Repeat for each step.
5. Debug adjacent pairs (1+2, 2+3...) for handoff correctness
6. Only after all pairs pass: run full chain

Step failure → debug that step only, re-run from there. Never skip forward.

## IMPORT-BASED DEBUGGING

Always import actual codebase modules. Never rewrite logic inline — that debugs your reimplementation, not the real code.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Witnessed import output = resolved mutable. Reimplemented output = UNKNOWN.

## TOOL REFERENCE

**`exec:<lang>`** — THE ONLY WAY TO RUN CODE. Bash tool body: `exec:<lang>\n<code>`. Languages: `exec:nodejs` (default) | `exec:python` | `exec:bash` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`. `cwd` sets directory. File I/O via exec:nodejs with require('fs'). Only git directly in bash.

`Bash(node ...)` `Bash(npm ...)` `Bash(npx ...)` `Bash(bun ...)` = violations. Use `exec:<lang>`.

**`code-search`** — Invoke `code-search` skill. MANDATORY for all exploration. Glob/Grep/Read/Explore/WebSearch blocked. Fallback: `bun x codebasesearch <query>`.

**`agent-browser`** — Invoke `agent-browser` skill. Escalation: (1) `exec:agent-browser\n<js>` first → (2) skill + `__gm` globals → (3) navigate/click → (4) screenshot last resort.

**`process-management`** — Invoke `process-management` skill. MANDATORY for all servers/workers/daemons. Pre-check before start. Delete on completion.

## BROWSER DEBUGGING SCAFFOLD

Inject before any browser state assertion:
```js
window.__gm = { captures: [], log: (...a) => window.__gm.captures.push({t:Date.now(),a}), assert: (l,c) => { window.__gm.captures.push({l,pass:!!c,val:c}); return !!c; }, dump: () => JSON.stringify(window.__gm.captures,null,2) };
```

## DUAL-SIDE DEBUGGING

Backend via `exec:nodejs`, frontend via `agent-browser` + `__gm`. Neither substitutes the other. Single-side = UNKNOWN mutable = blocked gate.

## GROUND TRUTH

Real services, real API responses, real timing. On discovering mocks/fakes/stubs: delete immediately, implement real paths. No .test.js/.spec.js files. No mock files. Delete on discovery.

## CONSTRAINTS

**Never**: `Bash(node/npm/npx/bun/python)` | fake data | mock files | Glob/Grep/Explore for discovery | puppeteer/playwright | screenshot before JS exhausted | independent items sequentially

**Always**: import real modules | witness every hypothesis | delete mocks on discovery | fix immediately | snake back when blocked

---

**→ FORWARD**: All mutables KNOWN → invoke `gm-emit` skill.
**↩ SNAKE to EXECUTE**: hypothesis wrong → re-invoke `gm-execute` with corrected approach.
**↩ SNAKE to PLAN**: .prd needs restructure → invoke `planning` skill.
