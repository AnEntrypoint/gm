---
name: gm-emit
description: EMIT phase. Pre-emit debugging, file writing, post-emit verification. Invoke when all EXECUTE mutables resolved. Snake back from VERIFY if files need fixes.
---

# GM EMIT — Writing and Verifying Files

You are in the **EMIT** phase. Every mutable was resolved in EXECUTE. Now prove the write is correct, write, then confirm from disk.

**GRAPH POSITION**: `PLAN → EXECUTE → [EMIT] → VERIFY → COMPLETE`
- **Entry chain**: prompt-submit hook → `gm` skill → `planning` → `gm-execute` → `gm-emit` (here). Also entered via snake from VERIFY.

## TRANSITIONS

**FORWARD (ladders)**:
- All gates pass simultaneously → invoke `gm-complete` skill

**BACKWARD (snakes) — when to leave this phase**:
- Pre-emit debugging reveals logic error not caught in EXECUTE → snake back: invoke `gm-execute` skill, re-resolve the broken mutable, return here
- Post-emit verification shows disk output differs from expected → fix in this phase immediately, do not advance, re-run verification
- Scope changed mid-emit, .prd items no longer accurate → snake back: invoke `planning` skill to revise .prd
- From VERIFY: end-to-end reveals broken file → snake back here, fix file, re-verify post-emit, then re-advance to VERIFY

**WHEN TO SNAKE TO EXECUTE**: logic is wrong, needs re-debugging before re-writing
**WHEN TO SNAKE TO PLAN**: requirements changed, .prd items need restructure
**WHEN TO STAY HERE**: file written but post-emit verification fails → fix immediately, re-verify

## MUTABLE DISCIPLINE

Each gate condition is a mutable. Pre-emit run = expected value. Post-emit run = current value. Zero variance required. Any unresolved gate = absolute barrier. State-tracking mutables in conversation only, never written to files.

## PRE-EMIT DEBUGGING (before writing any file)

1. Import actual module from disk via `exec:nodejs` — witness current on-disk behavior
2. Run proposed logic in isolation WITHOUT writing any file — witness output with real inputs
3. Debug failure paths with real error inputs
4. For browser code: inject `__gm` globals, run interactions, dump captures, verify

`exec:nodejs\nconst { fn } = await import('/abs/path')` — never rewrite logic inline.

Pre-emit run failing → snake back to `gm-execute` skill, do not write.

## WRITING FILES

Use `exec:nodejs` with `require('fs')`. Write only when every gate mutable is `resolved=true` simultaneously.

## POST-EMIT VERIFICATION (immediately after writing)

1. Load actual modified file from disk via real import — not in-memory version
2. Output must match pre-emit run exactly — any variance = regression
3. For browser: reload from disk, re-inject `__gm` globals, re-run, compare captures
4. Variance → fix immediately, re-verify. Never advance with variance.

## GATE CONDITIONS (all must be true simultaneously)

- Pre-emit run passed with real inputs and real error inputs
- Post-emit verification matches pre-emit run exactly
- Hot reloadable: state outside reloadable modules, handlers swap atomically
- Crash-proof: catch at every boundary, recovery hierarchy
- No mocks/fakes/stubs anywhere
- Files ≤200 lines
- No duplicate code, no comments, no hardcoded values
- Docs-code sync: CLAUDE.md reflects actual behavior

## TOOL REFERENCE

**`exec:<lang>`** — Bash tool: `exec:<lang>\n<code>`. `exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:java` | `exec:deno` | `exec:cmd`. Only git directly in bash.

**`agent-browser`** — Invoke `agent-browser` skill. Escalation: (1) `exec:agent-browser\n<js>` → (2) skill + `__gm` globals → (3) navigate/click → (4) screenshot last resort.

**`code-search`** — Invoke `code-search` skill. Glob/Grep/Explore blocked.

## SELF-CHECK (before and after each file)

File ≤200 lines | No duplication | Pre-emit run passed | No mocks | No comments | Docs match | All spotted issues fixed immediately

## CONSTRAINTS

**Never**: write before pre-emit run passes | advance with post-emit variance | skip doc sync | defer spotted issues | comments in code | hardcoded values

**Always**: pre-emit debug before writing | post-emit verify after writing | dual-side for full-stack | fix immediately | snake back when blocked

---

**→ FORWARD**: All gates pass → invoke `gm-complete` skill.
**↩ SNAKE to EXECUTE**: logic wrong → invoke `gm-execute` skill.
**↩ SNAKE to PLAN**: scope changed → invoke `planning` skill.
**↩ SNAKE from VERIFY**: file broken → fix here, re-verify, re-advance.
