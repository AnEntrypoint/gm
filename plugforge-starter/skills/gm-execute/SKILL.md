---
name: gm-execute
description: EXECUTE phase. Resolve all mutables via witnessed execution. Any new unknown triggers immediate snake back to planning — restart chain from PLAN.
---

# GM EXECUTE — Resolving Every Unknown

You are in the **EXECUTE** phase. Resolve every named mutable via witnessed execution. Any new unknown = stop, snake to `planning`, restart chain.

**GRAPH POSITION**: `PLAN → [EXECUTE] → EMIT → VERIFY → COMPLETE`
- **Entry**: .prd exists with all unknowns named. Entered from `planning` or via snake from EMIT/VERIFY.

## TRANSITIONS

**EXIT — invoke `gm-emit` skill immediately when**: All mutables are KNOWN (zero UNKNOWN remaining). Do not wait, do not summarize. Invoke the skill.

**SELF-LOOP (remain in EXECUTE state)**: Mutable still UNKNOWN after one pass → re-run with different angle (max 2 passes, then regress to PLAN)

**STATE REGRESSIONS**:
- New unknown discovered → invoke `planning` skill immediately, reset to PLAN state
- EXECUTE mutable unresolvable after 2 passes → invoke `planning` skill, reset to PLAN state
- Re-entered from EMIT state (logic error) → re-resolve the mutable, then re-invoke `gm-emit` skill
- Re-entered from VERIFY state (runtime failure) → re-resolve with real system state, then re-invoke `gm-emit` skill

## MUTABLE DISCIPLINE

Each mutable: name | expected | current | resolution method. Execute → witness → assign → compare. Zero variance = resolved. Unresolved after 2 passes = new unknown = snake to `planning`. Never narrate past an unresolved mutable.

## CODE EXECUTION

**exec:<lang> is the only way to run code.** Bash tool body: `exec:<lang>\n<code>`

`exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`

Lang auto-detected if omitted. `cwd` sets directory. File I/O via exec:nodejs + require('fs'). Only git in bash directly. `Bash(node/npm/npx/bun)` = violations.

**Execution efficiency — pack every run:**
- Combine multiple independent operations into one exec call using `Promise.allSettled` or parallel subprocess spawning
- Each independent idea gets its own try/catch with independent error reporting — never let one failure block another
- Target under 12s per exec call; split work across multiple calls only when dependencies require it
- Prefer a single well-structured exec that does 5 things over 5 sequential execs

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

## DIAGNOSTIC PROTOCOL — IMPORT-BASED EXECUTION

Always import actual codebase modules. Never rewrite logic inline. Reimplemented output is unwitnessed and inadmissible as ground truth.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Witnessed import output = resolved mutable. Reimplemented output = UNKNOWN.

**Differential diagnosis**: when behavior diverges from expectation, run the smallest possible isolation test first. Compare actual vs expected. Name the delta. The delta is the mutable — resolve it before touching any file.

## EXECUTION DENSITY

Pack every related hypothesis into one run. Each run ≤15s. Witnessed output = ground truth. Narrated assumption = inadmissible.

Parallel waves: ≤3 `gm:gm` subagents via Agent tool (`Agent(subagent_type="gm:gm", ...)`) — independent items simultaneously, never sequentially.

## CHAIN DECOMPOSITION — FAULT ISOLATION

Break every multi-step operation before running end-to-end. Treat each step as a diagnostic unit:
1. Number every distinct step
2. Per step: input shape, output shape, success condition, failure mode
3. Run each step in isolation — witness output — assign mutable — must be KNOWN before proceeding to next step
4. Debug adjacent step pairs for handoff correctness — the seam between steps is the most common failure site
5. Only when all pairs pass: run full chain end-to-end

Step failure revealing new unknown → regress to `planning` state immediately.

## BROWSER DIAGNOSTIC ESCALATION

Invoke `browser` skill. Exhaust each level before advancing to next:
1. `exec:browser\n<js>` — inspect DOM state, read globals, check network responses. Always first.
2. `browser` skill — for full session workflows requiring navigation
3. navigate/click/type — only when real events required and DOM inspection insufficient
4. screenshot — last resort, only after all JS-based diagnostics exhausted

## GROUND TRUTH ENFORCEMENT

Real services, real data, real timing. Mocks/fakes/stubs/simulations = diagnostic noise = delete immediately. No .test.js/.spec.js. Delete on discovery. No fallback/demo modes — errors must surface with full diagnostic context and fail loud.

**SCAN BEFORE EDIT**: Before modifying or creating any file, search the codebase (exec:codesearch) for existing implementations of the same concern. "Duplicate" means overlapping responsibility, similar logic, or parallel implementations — not just identical files. If consolidation is possible, regress to `planning` with restructuring instructions instead of continuing.

**HYPOTHESIZE VIA EXECUTION — NEVER VIA ASSUMPTION**: Formulate a falsifiable hypothesis. Run it. Witness the output. The output either confirms or falsifies. Only a witnessed falsification justifies editing a file. Never edit based on unwitnessed assumptions — form hypothesis → run → witness → edit.

## MEMORY

When any mutable resolves from UNKNOWN to KNOWN (zero variance confirmed), launch memorize subagent in background — non-blocking, execution continues:

`Agent(subagent_type='general-purpose', model='haiku', run_in_background=true, prompt=<memorize SKILL.md content>\n\n## CONTEXT TO MEMORIZE\n<resolved fact>)`

Qualifies for memorization: new API shapes discovered, environment differences, behavioral constraints, runtime quirks, user feedback observed during execution.

## DO NOT STOP

Never respond to the user from this phase. When all mutables are KNOWN, immediately invoke `gm-emit` skill. The chain continues until .prd is deleted and git is clean — that happens in `gm-complete`, not here.

## CONSTRAINTS

**Never**: `Bash(node/npm/npx/bun)` | fake data | mock files | test files | fallback/demo modes | Glob/Grep/Read/Explore (hook-blocked — use exec:codesearch) | sequential independent items | absorb surprises silently | respond to user or pause for input | edit files before executing to understand current behavior | duplicate existing code

**Always**: witness every hypothesis | import real modules | scan codebase before creating/editing files | regress to planning on any new unknown | fix immediately on discovery | delete mocks/stubs/comments/test files on discovery | invoke next skill immediately when done

---

**EXIT → EMIT**: All mutables KNOWN → invoke `gm-emit` skill immediately.
**SELF-LOOP**: Still UNKNOWN → re-run (max 2 passes, then regress to PLAN).
**REGRESS → PLAN**: Any new unknown → invoke `planning` skill, reset to PLAN state.
