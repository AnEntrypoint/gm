---
name: gm-execute
description: EXECUTE phase methodology. Hypothesis testing, chain decomposition, import-based verification, browser protocols, ground truth enforcement.
---

# GM EXECUTE — Proving Every Hypothesis

You are in the **EXECUTE** phase. All mutables must resolve to KNOWN via witnessed execution before transitioning to EMIT.

**GRAPH POSITION**: `PLAN → [EXECUTE] → EMIT → VERIFY → COMPLETE`
- **Session entry chain**: prompt-submit hook → `gm` skill → `planning` skill → `gm-execute` skill (here). The `gm` skill contract is active: state machine, mutable discipline, ground truth only, all transitions invoke named skills.
- **Entry**: .prd exists with all unknowns named. This skill owns the EXECUTE phase entirely.
- **Exit**: Zero unresolved mutables → invoke `gm-emit` skill for gate validation and file writing.
- **Sub-skills**: code discovery → invoke `code-search` skill | browser work → invoke `agent-browser` skill | servers/workers/daemons → invoke `process-management` skill
- **Re-entry**: If mutables remain unresolved, re-invoke `gm-execute` skill with broader scope. Never add stages.

## MUTABLE DISCIPLINE

Enumerate all unknowns as named mutables. Each mutable: name, expected value, current value, resolution method. Execute → witness → assign → compare → zero variance = resolved. Unresolved = absolute barrier. Never narrate. Assign, execute, resolve, transition. State-tracking mutables live in conversation only. Never written to files.

## HYPOTHESIS TESTING

Every hypothesis proven by execution before changing files. Know nothing until execution proves it.

**DENSITY**: Each execution ≤15s, packed with every related hypothesis. Group every related unknown into one run. Never one idea per run.

**PARALLEL WAVES**: Launch ≤3 gm:gm subagents per wave via Task tool. Independent items run simultaneously. Sequential execution = violation. Waves of ≤3; batches >3 split.

## CHAIN DECOMPOSITION

Every multi-step chain broken into individually-verified steps BEFORE any end-to-end run:
1. List every distinct operation as numbered steps
2. Per step: define input shape, output shape, success condition, failure condition
3. Execute step 1 in isolation → witness → assign mutable → proceed only when KNOWN
4. Execute step 2 with step 1's witnessed output as input. Repeat for every step.
5. After all steps pass individually, test adjacent pairs for handoff correctness
6. Only after all pairs pass: run full chain end-to-end

## IMPORT-BASED EXECUTION

Always import actual codebase modules. Never rewrite logic inline.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Witnessed import output = resolved mutable. Reimplemented output = UNKNOWN.

## TOOL REFERENCE

**`exec:<lang>`** — Bash tool: `exec:<lang>\n<code>`. Languages: `exec:nodejs` (default) | `exec:python` | `exec:bash` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`. Lang auto-detected if omitted. `cwd` field sets working directory. File I/O: exec:nodejs with require('fs'). Bash scope: only git directly. All else via exec interception.

**`code-search`** — Semantic code discovery. Invoke `code-search` skill. MANDATORY for all exploration. Glob/Grep/Read-for-discovery/Explore/WebSearch blocked. Fallback: `bun x codebasesearch <query>`. Try 5+ queries before alternatives.

**`agent-browser`** — Invoke `agent-browser` skill. Replaces puppeteer/playwright entirely. Escalation order:
1. `exec:agent-browser\n<js>` — query DOM/state via JS. Always first.
2. `agent-browser` skill + `__gm` globals + evaluate — instrument, intercept, capture.
3. navigate/click/type — only when state requires real events.
4. screenshot — LAST RESORT. Screenshot before exhausting 1–3 = blocked gate.

**`process-management`** — Invoke `process-management` skill. MANDATORY for all servers/workers/daemons. Pre-check before start. Delete on completion. Orphaned processes = gate violation. Direct node/bun/python for servers = violation.

## BROWSER GLOBALS SCAFFOLD

Inject before any browser state assertion:
```js
window.__gm = { captures: [], log: (...a) => window.__gm.captures.push({t:Date.now(),a}), assert: (l,c) => { window.__gm.captures.push({l,pass:!!c,val:c}); return !!c; }, dump: () => JSON.stringify(window.__gm.captures,null,2) };
```

## DUAL-SIDE VALIDATION

Backend via `exec:nodejs`, frontend via `agent-browser` + `__gm`. Neither substitutes. Single-side = UNKNOWN mutable = blocked gate.

## GROUND TRUTH

Real services, real API responses, real timing only. On discovering mocks/fakes/stubs: delete immediately, implement real paths. Unit testing forbidden: no .test.js/.spec.js, no mock files. Delete on discovery.

## CONSTRAINTS (EXECUTE-PHASE)

**Tier 0 (ABSOLUTE)**: immortality, no_crash, no_exit, ground_truth_only, real_execution
**Tier 1 (CRITICAL)**: max_file_lines=200, hot_reloadable, checkpoint_state

**Never**: fake data | write test files | use Glob/Grep/Explore for discovery | direct bash non-git | puppeteer/playwright | screenshot before JS | independent items sequentially

**Always**: import real modules | delete mocks on discovery | witness every hypothesis | fix issues immediately

---

**→ NEXT**: When all mutables resolved → invoke `gm-emit` skill for gate validation and file writing.
