---
name: gm-execute
description: EXECUTE phase methodology. Hypothesis testing, chain decomposition, import-based verification, browser protocols, ground truth enforcement.
---

# GM EXECUTE — Proving Every Hypothesis

You are in the **EXECUTE** phase. All mutables must resolve to KNOWN via witnessed execution before transitioning to EMIT.

**GRAPH POSITION**: `PLAN → [EXECUTE] → EMIT → VERIFY → COMPLETE`
- **Entry**: .prd exists with all unknowns named
- **Exit**: Zero unresolved mutables. All hypotheses witnessed.
- **Next**: When all mutables resolved → invoke `gm-emit` skill for gate validation and file writing.
- **Re-entry**: If mutables remain unresolved after a pass, re-enter EXECUTE with broader script. Never add stages.

## MUTABLE DISCIPLINE

- Enumerate all unknowns as named mutables (`fileExists=UNKNOWN`, `schemaValid=UNKNOWN`)
- Each mutable: name, expected value, current value, resolution method
- Execute → witness → assign → compare → zero variance = resolved
- Unresolved = absolute barrier. Never narrate. Assign, execute, resolve, transition.
- State-tracking mutables live in conversation only. Never written to files.

## HYPOTHESIS TESTING

Every hypothesis proven by execution before changing files. Know nothing until execution proves it.

**DENSITY**: Each execution ≤15s, packed with every related hypothesis. File existence, schema validity, output format, error conditions, edge cases — group every related unknown into one run. Never one idea per run. The goal is maximum hypotheses per execution.

**PARALLEL WAVES**: Launch ≤3 gm:gm subagents per wave via Task tool. Independent items run simultaneously. Sequential execution of independent items = violation. Waves of ≤3; batches >3 split. Complete each batch before starting next.

## CHAIN DECOMPOSITION

Every multi-step chain broken into individually-verified steps BEFORE any end-to-end run:

1. List every distinct operation as numbered steps (1:parse → 2:validate → 3:transform → 4:write → 5:confirm)
2. Per step: define input shape, output shape, success condition, failure condition
3. Execute step 1 in isolation → witness → assign mutable → proceed only when KNOWN
4. Execute step 2 with step 1's witnessed output as input. Repeat for every step.
5. After all steps pass individually, test adjacent pairs (1+2, 2+3, 3+4...) for handoff correctness
6. Only after all pairs pass: run full chain end-to-end
7. Step failure → fix that step only, rerun from there. Never skip forward.

Decomposition rules:
- Stateless operations isolated first (pure logic, no dependencies)
- Stateful operations tested with their immediate downstream effect (shared state boundary)
- Same assertion target = same run (same variable, same API call, same file)
- Unrelated assertion targets = separate runs

## IMPORT-BASED EXECUTION

Always import actual codebase modules. Never rewrite logic inline — that tests your reimplementation, not the actual code.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

- Call real functions with real inputs. Witness real output. This IS ground truth.
- When codebase uses a library, import that same library version from actual node_modules.
- Set `cwd` field on Bash tool when code needs to import from a specific project directory.
- Witnessed import output = resolved mutable. Reimplemented output = UNKNOWN mutable.

## TOOL SELECTION

**`exec:<lang>`** — All code execution. Bash tool: `exec:<lang>\n<code>`.
- `exec:nodejs` (default; aliases: exec, js, javascript, node) | `exec:python` (py) | `exec:bash` (sh, shell, zsh) | `exec:typescript` (ts)
- `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`
- Lang auto-detected if omitted. `cwd` field sets working directory.
- File I/O: `exec:nodejs` with inline `require('fs')`.
- Background tasks: `bun x gm-exec status|sleep|close|runner <args>`.
- Bash scope: only `git` directly. All else via exec interception.
- Post-exec hygiene: `exec:bash\ngit status --porcelain` must be empty. Use temp dir for throwaway code.

**Tool by operation**:
- Pure logic / API calls / state mutations: `exec:nodejs` with real imports
- Shell / filesystem / git: `exec:bash`
- DOM state / JS vars / network: `exec:agent-browser\n<js>` first
- Rendering / user interaction: `agent-browser` skill + `__gm` globals
- Screenshots: absolute last resort

**`code-search`** — Semantic code discovery. MANDATORY for all exploration. Natural language → ranked results with line numbers. Glob/Grep/Read-for-discovery/Explore/WebSearch blocked. Fallback: `bun x codebasesearch <query>`. Use liberally (<$0.01, <1s each). Try 5+ queries before alternatives.

**`process-management`** — PM2 lifecycle. MANDATORY for all servers/workers/daemons. Pre-check before start. Delete on completion. Orphaned processes = gate violation. Direct node/bun/python for servers = violation.

## BROWSER PROTOCOLS

**`agent-browser`** replaces puppeteer/playwright entirely. Escalation order (exhaust before advancing):
1. `exec:agent-browser\n<js>` — query DOM/state via JS. Always first.
2. `agent-browser` skill + `__gm` globals + evaluate — instrument, intercept, capture.
3. navigate/click/type — only when state requires real events.
4. screenshot — LAST RESORT. Screenshot before exhausting 1–3 = blocked gate.

**`__gm` globals scaffold** — inject before any browser state assertion:
```js
window.__gm = {
  captures: [],
  log: (...args) => window.__gm.captures.push({t: Date.now(), args}),
  assert: (label, cond) => { window.__gm.captures.push({label, pass: !!cond, val: cond}); return !!cond; },
  dump: () => JSON.stringify(window.__gm.captures, null, 2)
};
```

Instrument via function interception:
```js
window._orig = window.target; window.target = (...a) => { window.__gm.log('target', a); return window._orig(...a); };
```

Capture network via fetch/XHR interception. All UI state mutables resolve from `__gm.captures` only — not visual inspection.

**DUAL-SIDE VALIDATION**: Backend via `exec:nodejs`, frontend via `agent-browser` + `__gm`. Neither substitutes. Single-side = UNKNOWN mutable = blocked gate. A server test passing does NOT prove UI works. A browser test passing does NOT prove backend handles edge cases.

## GROUND TRUTH

Real services, real API responses, real timing only. On discovering mocks/fakes/stubs/fixtures/simulations/test doubles: identify all instances, trace what they fake, implement real paths, delete all fake code, verify with real data. When real services unavailable, surface the blocker.

Unit testing forbidden: no .test.js/.spec.js/.test.ts/.spec.ts, no test/__tests__/ dirs, no mock/stub/fixture files, no test frameworks or dependencies. Delete on discovery. Verify via `exec:<lang>` with actual services only.

## SYSTEM ARCHITECTURE REQUIREMENTS

Code produced during EXECUTE must satisfy:

**Hot Reload**: State outside reloadable modules. Handlers swap atomically. Zero downtime. Old handlers drain before new attach. Monolithic non-reloadable modules forbidden.

**Uncrashable**: Catch at every boundary. Nothing propagates to termination. Recovery hierarchy: retry w/backoff → restart component → supervisor → parent supervisor → top-level catch/log/recover. Every component supervised. Checkpoint continuously. Fresh state on recovery loops. System runs forever.

**Recovery**: Checkpoint to known good state. Fast-forward past corruption. Track failure counters. Auto-fix. Never crash as recovery. Never require human intervention first.

**Async**: Contain all promises. Debounce entry. Signals/emitters for coordination. Locks on critical sections.

**Debug**: Hook state to global scope. Expose internals. Provide REPL handles.

## CONSTRAINTS (EXECUTE-PHASE)

**Tier 0 (ABSOLUTE)**: immortality, no_crash, no_exit, ground_truth_only, real_execution
**Tier 1 (CRITICAL)**: max_file_lines=200, hot_reloadable, checkpoint_state

**Never**: fake data | write test files | use Glob/Grep/Explore for discovery | direct bash (non-git, non-exec) | puppeteer/playwright | defer spotted issues | screenshot before JS execution | independent items sequentially

**Always**: exec via `exec:<lang>` or `agent-browser` | import real modules | delete mocks on discovery | witness every hypothesis | ground truth only | fix issues immediately on sight

---

**→ NEXT**: When all mutables are resolved to KNOWN via witnessed execution, invoke `gm-emit` skill for gate validation and file writing.
