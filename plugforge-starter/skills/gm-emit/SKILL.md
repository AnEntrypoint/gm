---
name: gm-emit
description: EMIT phase gate validation, pre/post-emit testing, code quality enforcement. Invoke when all EXECUTE mutables resolved and ready to write files.
---

# GM EMIT — Gate Validation and File Writing

You are in the **EMIT** phase. All mutables were resolved in EXECUTE. Now validate, write, and verify files.

**GRAPH POSITION**: `PLAN → EXECUTE → [EMIT] → VERIFY → COMPLETE`
- **Session entry chain**: prompt-submit hook → `gm` skill → `planning` → `gm-execute` → `gm-emit` skill (here). The `gm` skill contract is active: state machine, mutable discipline, ground truth only, all transitions invoke named skills.
- **Entry**: All EXECUTE mutables resolved to KNOWN via witnessed execution. .prd items are scoped and proven.
- **Exit**: Files written, post-emit validation passes, all gate conditions true simultaneously → invoke `gm-complete` skill.
- **Rollback**: If post-emit validation fails → fix immediately in this phase, do not advance.

## MUTABLE DISCIPLINE

Each gate condition is a mutable that must resolve to `true` before files are written. Pre-emit test results = expected values. Post-emit test results = current values. Zero variance required. Unresolved gate mutable = absolute barrier to VERIFY phase. State-tracking mutables live in conversation only. Never written to files.

## PRE-EMIT-TEST (before writing any file)

1. Import the actual module from disk via `exec:nodejs`, witness current on-disk behavior
2. Execute proposed logic in isolation — WITHOUT writing to any file
3. Witness correct output with real inputs. Test failure paths with real error inputs.
4. For browser code: inject `__gm` globals, run interactions, dump captures, verify

Always: `exec:nodejs\nconst { fn } = await import('/abs/path')` — never rewrite logic inline.

## WRITING FILES

Use `exec:nodejs` with `require('fs')` for all file operations. Write all files only when every gate mutable is `resolved=true` simultaneously.

## POST-EMIT-VALIDATION (immediately after writing)

1. Load actual modified file from disk via real import — not in-memory version
2. Output must match PRE-EMIT-TEST witnessed output exactly
3. For browser: reload from disk, re-inject `__gm` globals, re-run interactions, compare captures
4. Any variance = regression, fix immediately before proceeding

## GATE CONDITIONS (all must be true simultaneously)

- Executed via `exec:<lang>` or `agent-browser` — witnessed real output
- Every scenario tested: success, failure, edge, corner, error, recovery
- Real witnessed output proves goal achieved
- Hot reloadable: state outside reloadable modules, handlers swap atomically
- Crash-proof: catch at every boundary, recovery hierarchy, every component supervised
- No mocks/fakes/stubs anywhere in codebase
- Files ≤200 lines each
- No duplicate code
- No comments in code
- No hardcoded values
- Docs-code sync: CLAUDE.md reflects actual code behavior

## TOOL REFERENCE

**`exec:<lang>`** — Bash tool: `exec:<lang>\n<code>`. Languages: `exec:nodejs` (default) | `exec:python` | `exec:bash` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:java` | `exec:deno` | `exec:cmd`. Lang auto-detected. `cwd` sets directory. File I/O via exec:nodejs with require('fs'). Bash: only git directly.

**`agent-browser`** — Invoke `agent-browser` skill. Escalation: (1) `exec:agent-browser\n<js>` first → (2) skill + `__gm` globals → (3) navigate/click → (4) screenshot last resort.

**`code-search`** — Invoke `code-search` skill. MANDATORY for all exploration. Glob/Grep/Explore blocked.

## DUAL-SIDE VALIDATION

Backend proven with `exec:nodejs`, frontend with `agent-browser` + `__gm`. Neither substitutes. Single-side = UNKNOWN mutable = blocked gate.

## SELF-CHECK (before and after each file)

1. File ≤200 lines | 2. No duplicate code | 3. Pre-emit test passed | 4. No mocks | 5. No comments | 6. Docs match code | 7. All spotted issues fixed

Score = 100 - (T0_violations×50) - (T1_violations×20) - (T2_violations×5). Target ≥95.

## GROUND TRUTH

Real services only. On discovering mocks/fakes/stubs: delete immediately, implement real paths.

## CONSTRAINTS (EMIT-PHASE)

**Never**: skip pre-emit testing | skip post-emit validation | leave docs-code desync | defer spotted issues | advance with failing gate | comments in code | hardcoded values

**Always**: pre-emit test before writing | post-emit validate after writing | dual-side for full-stack | self-check every file | reconcile docs | fix immediately

---

**→ NEXT**: When all gate conditions pass → invoke `gm-complete` skill for end-to-end verification and git enforcement.
