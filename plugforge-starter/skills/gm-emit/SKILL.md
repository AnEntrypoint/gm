---
name: gm-emit
description: EMIT phase. Pre-emit debug, write files, post-emit verify from disk. Any new unknown triggers immediate snake back to planning — restart chain.
---

# GM EMIT — Writing and Verifying Files

You are in the **EMIT** phase. Every mutable is KNOWN. Prove the write is correct, write, confirm from disk. Any new unknown = snake to `planning`, restart chain.

**GRAPH POSITION**: `PLAN → EXECUTE → [EMIT] → VERIFY → COMPLETE`
- **Entry**: All .prd mutables resolved. Entered from `gm-execute` or via snake from VERIFY.

## TRANSITIONS

**FORWARD**: All gate conditions true simultaneously → invoke `gm-complete` skill

**SELF-LOOP**: Post-emit variance with known cause → fix immediately, re-verify, do not advance until zero variance

**BACKWARD**:
- Pre-emit reveals logic error (known mutable) → invoke `gm-execute` skill, re-resolve, return here
- Pre-emit reveals new unknown → invoke `planning` skill, restart chain
- Post-emit variance with unknown cause → invoke `planning` skill, restart chain
- Scope changed → invoke `planning` skill, restart chain
- From VERIFY: end-to-end reveals broken file → re-enter here, fix, re-verify, re-advance

## MUTABLE DISCIPLINE

Each gate condition is a mutable. Pre-emit run witnesses expected value. Post-emit run witnesses current value. Zero variance = resolved. Variance with unknown cause = new unknown = snake to `planning`.

## CODE EXECUTION

**exec:<lang> is the only way to run code.** Bash tool body: `exec:<lang>\n<code>`

`exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:java` | `exec:deno` | `exec:cmd`

Only git in bash directly. `Bash(node/npm/npx/bun)` = violations. File writes via exec:nodejs + require('fs').

## PRE-EMIT DEBUGGING (before writing any file)

1. Import actual module from disk via `exec:nodejs` — witness current on-disk behavior
2. Run proposed logic in isolation WITHOUT writing — witness output with real inputs
3. Debug failure paths with real error inputs — record expected values

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Pre-emit revealing unexpected behavior → new unknown → snake to `planning`.

## WRITING FILES

`exec:nodejs` with `require('fs')`. Write only when every gate mutable is `resolved=true` simultaneously.

## POST-EMIT VERIFICATION (immediately after writing)

1. Re-import the actual file from disk — not in-memory version
2. Run same inputs as pre-emit — output must match exactly
3. For browser: reload from disk, re-inject `__gm` globals, re-run, compare captures
4. Known variance → fix and re-verify | Unknown variance → snake to `planning`

## GATE CONDITIONS (all true simultaneously before advancing)

- Pre-emit debug passed with real inputs and error inputs
- Post-emit verification matches pre-emit exactly
- Hot reloadable: state outside reloadable modules, handlers swap atomically
- Crash-proof: catch at every boundary, recovery hierarchy
- No mocks/fakes/stubs anywhere
- Files ≤200 lines, no duplicate code, no comments, no hardcoded values
- CLAUDE.md reflects actual behavior

## CODEBASE EXPLORATION

```
exec:codesearch
<natural language description>
```

Alias: `exec:search`. Glob, Grep, Explore = blocked.

## BROWSER DEBUGGING

Invoke `agent-browser` skill. Escalation: (1) `exec:agent-browser\n<js>` → (2) skill + `__gm` globals → (3) navigate/click → (4) screenshot last resort.

## SELF-CHECK (before and after each file)

File ≤200 lines | No duplication | Pre-emit passed | No mocks | No comments | Docs match | All spotted issues fixed

## CONSTRAINTS

**Never**: write before pre-emit passes | advance with post-emit variance | absorb surprises silently | comments | hardcoded values | defer spotted issues

**Always**: pre-emit debug before writing | post-emit verify from disk | snake to planning on any new unknown | fix immediately

---

**→ FORWARD**: All gates pass → invoke `gm-complete` skill.
**↺ SELF-LOOP**: Known post-emit variance → fix, re-verify.
**↩ SNAKE to EXECUTE**: Known logic error → invoke `gm-execute` skill.
**↩ SNAKE to PLAN**: Any new unknown → invoke `planning` skill, restart chain.
