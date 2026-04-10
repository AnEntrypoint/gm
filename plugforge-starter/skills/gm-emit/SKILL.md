---
name: gm-emit
description: EMIT phase. Pre-emit debug, write files, post-emit verify from disk. Any new unknown triggers immediate snake back to planning — restart chain.
---

# GM EMIT — Writing and Verifying Files

You are in the **EMIT** phase. Every mutable is KNOWN. Prove the write is correct, write, confirm from disk. Any new unknown = snake to `planning`, restart chain.

**GRAPH POSITION**: `PLAN → EXECUTE → [EMIT] → VERIFY → COMPLETE`
- **Entry**: All .prd mutables resolved. Entered from `gm-execute` or via snake from VERIFY.

## TRANSITIONS

**EXIT — invoke `gm-complete` skill immediately when**: All gate conditions are true simultaneously. Do not pause. Invoke the skill.

**SELF-LOOP (remain in EMIT state)**: Post-emit variance with known cause → fix immediately, re-verify, do not advance until zero variance

**STATE REGRESSIONS**:
- Pre-emit reveals logic error (known mutable) → invoke `gm-execute` skill, reset to EXECUTE, return here after resolution
- Pre-emit reveals new unknown → invoke `planning` skill, reset to PLAN state
- Post-emit variance with unknown cause → invoke `planning` skill, reset to PLAN state
- Scope changed → invoke `planning` skill, reset to PLAN state
- Re-entered from VERIFY state (broken file output) → fix, re-verify, then re-invoke `gm-complete` skill

## MUTABLE DISCIPLINE

Each gate condition is a mutable. Pre-emit run witnesses expected value. Post-emit run witnesses current value. Zero variance = resolved. Variance with unknown cause = new unknown = snake to `planning`.

## CODE EXECUTION

**exec:<lang> is the only way to run code.** Bash tool body: `exec:<lang>\n<code>`

`exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:java` | `exec:deno` | `exec:cmd`

Only git in bash directly. `Bash(node/npm/npx/bun)` = violations. File writes via exec:nodejs + require('fs').

**Execution efficiency — pack every run:**
- Combine multiple independent operations into one exec call using `Promise.allSettled` or parallel subprocess spawning
- Each independent idea gets its own try/catch with independent error reporting — never let one failure block another
- Target under 12s per exec call; split work across multiple calls only when dependencies require it
- Prefer a single well-structured exec that does 5 things over 5 sequential execs

## PRE-EMIT DIAGNOSTIC RUN (mandatory before writing any file)

The pre-emit run is a diagnostic pass. Its purpose is to falsify the write before it happens.

1. Import the actual module from disk via `exec:nodejs` — witness current on-disk behavior as the baseline
2. Run proposed logic in isolation WITHOUT writing — witness output with real inputs
3. Probe all failure paths with real error inputs — record expected vs actual for each
4. Compare: if proposed output matches expected → proceed to write. If not → new unknown, regress to `planning`.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Pre-emit revealing unexpected behavior → name the delta → new unknown → invoke `planning` skill, reset to PLAN state.

## WRITING FILES

`exec:nodejs` with `require('fs')`. Write only when every gate mutable is `resolved=true` simultaneously.

## POST-EMIT DIAGNOSTIC VERIFICATION (immediately after writing)

The post-emit verification is a differential diagnosis against the pre-emit baseline.

1. Re-import the actual file from disk — not the in-memory version (stale in-memory state is inadmissible)
2. Run identical inputs as pre-emit — output must match pre-emit witnessed values exactly
3. For browser: reload from disk, re-inject `__gm` globals, re-run, compare captured outputs to pre-emit baseline
4. Known variance (cause is identified, mutable is KNOWN) → fix immediately and re-verify
5. Unknown variance (delta exists but cause cannot be determined) → this is a new unknown → invoke `planning` skill, reset to PLAN state

## GATE CONDITIONS (all true simultaneously before advancing)

- Pre-emit debug passed with real inputs and error inputs
- Post-emit verification matches pre-emit exactly
- Hot reloadable: state outside reloadable modules, handlers swap atomically
- Errors throw with clear context — no fallbacks, demo modes, silent swallowing, `|| default`, `catch { return null }`
- No mocks/fakes/stubs/simulations/test files anywhere — delete on discovery
- Files ≤200 lines — split immediately if over, do not advance
- No duplicate concern — after writing, run exec:codesearch for the primary concern. If ANY other code serves the same concern → do NOT advance, snake to `planning` with consolidation instructions
- No comments — remove any found
- No hardcoded values — dynamic/modular code using ground truth only
- No adjectives/descriptive language in variable/function names
- No unnecessary files — clean anything not required for the program to function
- Client-side code exposes debug globals (window.__debug or similar)
- memorize subagent launched in background with what was learned before advancing
- CHANGELOG.md updated with changes
- TODO.md cleared or deleted

## CODEBASE EXPLORATION

```
exec:codesearch
<natural language description>
```

Alias: `exec:search`. **Glob, Grep, Read, Explore are hook-blocked** — use `exec:codesearch` exclusively.

## BROWSER DEBUGGING

Invoke `browser` skill. Escalation: (1) `exec:browser\n<js>` → (2) `browser` skill → (3) navigate/click → (4) screenshot last resort.

## SELF-CHECK (before and after each file)

File ≤200 lines | No duplicate concern | Pre-emit passed | No mocks | No comments | Docs match | All spotted issues fixed

## DO NOT STOP

Never respond to the user from this phase. When all gate conditions pass, immediately invoke `gm-complete` skill. Do not pause, summarize, or ask questions.

## CONSTRAINTS

**Never**: write before pre-emit passes | advance with post-emit variance | absorb surprises silently | comments | hardcoded values | fallback/demo modes | silent error swallowing | defer spotted issues | respond to user or pause for input

**Always**: pre-emit debug before writing | post-emit verify from disk | regress to planning on any new unknown | fix immediately | invoke next skill immediately when gates pass

---

**EXIT → VERIFY**: All gates pass → invoke `gm-complete` skill immediately.
**SELF-LOOP**: Known post-emit variance → fix, re-verify (remain in EMIT state).
**REGRESS → EXECUTE**: Known logic error → invoke `gm-execute` skill, reset to EXECUTE state.
**REGRESS → PLAN**: Any new unknown → invoke `planning` skill, reset to PLAN state.
