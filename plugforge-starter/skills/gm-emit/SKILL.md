---
name: gm-emit
description: EMIT phase gate validation, pre/post-emit testing, code quality enforcement. Invoke when all EXECUTE mutables resolved and ready to write files.
---

# GM EMIT — Gate Validation and File Writing

You are in the **EMIT** phase. All mutables were resolved in EXECUTE. Now validate, write, and verify files.

**GRAPH POSITION**: `PLAN → EXECUTE → [EMIT] → VERIFY → COMPLETE`
- **Entry**: All EXECUTE mutables resolved to KNOWN via witnessed execution.
- **Exit**: Files written, post-emit validation passes, all gate conditions true simultaneously.
- **Next**: When all gates pass → invoke `gm-complete` skill for end-to-end verification and git enforcement.
- **Rollback**: If post-emit validation fails → fix immediately in this phase, do not advance.

## MUTABLE DISCIPLINE

- Each gate condition is a mutable that must resolve to `true` before files are written
- Pre-emit test results = expected values. Post-emit test results = current values. Zero variance required.
- Unresolved gate mutable = absolute barrier to VERIFY phase.
- State-tracking mutables live in conversation only. Never written to files.

## PRE-EMIT-TEST (before writing any file)

1. Import the actual module from disk via `exec:nodejs`, witness current on-disk behavior
2. Execute proposed logic in isolation via `exec:nodejs` with real deps — WITHOUT writing to any file
3. Witness correct output with real inputs
4. Test failure paths with real error inputs
5. For browser code: inject `__gm` globals, run interactions, dump captures, verify

All mutables must be KNOWN (via real imports and real captures) before writing begins.

**Import-based execution**: Always `exec:nodejs\nconst { fn } = await import('/abs/path')` — never rewrite logic inline. Witnessed import output = resolved mutable. Reimplemented output = UNKNOWN.

## WRITING FILES

Write all files when every gate mutable is `resolved=true` simultaneously. Use `exec:nodejs` with `require('fs')` for file operations.

## POST-EMIT-VALIDATION (immediately after writing)

1. Load the actual modified file from disk via real import — not in-memory version
2. Output must match PRE-EMIT-TEST witnessed output exactly
3. For browser: reload page from disk, re-inject `__gm` globals, re-run interactions, compare captures
4. Any variance from PRE-EMIT-TEST = regression, fix immediately before proceeding
5. Both server imports AND browser captures must match

**DUAL-SIDE**: Backend proven with `exec:nodejs`, frontend with `agent-browser` + `__gm`. Neither substitutes. Single-side = UNKNOWN mutable = blocked gate.

## GATE CONDITIONS

All must be true simultaneously before advancing to VERIFY:

- Executed via `exec:<lang>` interception or `agent-browser` skill — witnessed real output
- Every scenario tested: success, failure, edge, corner, error, recovery, concurrent, timing
- Real witnessed output proves goal achieved
- No code orchestration
- Hot reloadable: state outside reloadable modules, handlers swap atomically, zero downtime
- Crash-proof: catch at every boundary, recovery hierarchy, every component supervised
- Debug hooks exposed: state on global scope, REPL handles
- No mocks/fakes/stubs/simulations anywhere in codebase
- Files ≤200 lines each
- No duplicate code (extract immediately if found)
- No comments in code
- No hardcoded values (configuration drives behavior)
- Ground truth only — real services, real data
- Cleanup complete — only code the project needs
- Docs-code sync: CLAUDE.md and README reflect actual code behavior. Reconcile before advancing.

## CODE QUALITY

All code written in EMIT must satisfy:

**Reduce**: Question every requirement. Default reject. Fewer requirements = less code.
**No Duplication**: Extract immediately. Two occurrences = consolidate now.
**No Adjectives**: What system does, never how good. No "optimized", "advanced", "improved".
**Convention Over Code**: Frameworks from patterns, ≤50 lines. Conventions scale; ad hoc rots.
**Modularity**: Pre-evaluate on every encounter. Worthwhile → implement immediately.
**Buildless**: Ship source. No build steps except optimization.
**Dynamic**: Configuration drives behavior, not conditionals. No hardcoded values.
**Cleanup**: Only code the project needs. No test files on disk.
**Immediate Fix**: Any inconsistency, violation, naming error, structural issue, or duplication spotted = fixed now. Not noted. Not deferred. Seeing a problem without fixing it = introducing it. Logical improvements identified = implemented immediately.

## SELF-CHECK (before and after emitting each file)

1. File ≤200 lines
2. No duplicate code (extract if found)
3. Real execution proven (PRE-EMIT-TEST passed)
4. No mocks/fakes anywhere
5. Checkpoint capability exists
6. No policy violations (naming, structure, comments, hardcoded values)
7. Docs match code — if CLAUDE.md or README describes this area, confirm it reflects what was just written
8. All spotted issues fixed, not deferred

Fail → fix before proceeding. Score = 100 - (T0_violations×50) - (T1_violations×20) - (T2_violations×5). Target ≥95. <70 → self-correct.

## SYSTEM ARCHITECTURE (written code must satisfy)

**Hot Reload**: State outside reloadable modules. Handlers swap atomically. Old drain before new attach.
**Uncrashable**: Catch at every boundary. Recovery hierarchy. Every component supervised. Checkpoint continuously.
**Recovery**: Checkpoint to known good state. Never crash as recovery. Never require human intervention first.
**Async**: Contain all promises. Debounce. Locks on critical sections.
**Debug**: Hook state to global scope. Expose internals.

## GROUND TRUTH

Real services, real API responses, real timing only. On discovering mocks/fakes/stubs: delete immediately, implement real paths. Unit testing forbidden: no .test.js/.spec.js, no test dirs, no mock files. Delete on discovery.

## TOOL REFERENCE

**`exec:<lang>`** — `exec:nodejs` (default) | `exec:python` | `exec:bash` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`. Lang auto-detected. `cwd` sets directory. File I/O via `exec:nodejs` with `require('fs')`. Bash: only `git` directly.

**`agent-browser`** — Escalation: (1) `exec:agent-browser\n<js>` first → (2) skill + `__gm` globals → (3) navigate/click → (4) screenshot last resort.

**`code-search`** — MANDATORY for all exploration. Glob/Grep/Explore blocked.

## CONSTRAINTS (EMIT-PHASE)

**Tier 0 (ABSOLUTE)**: ground_truth_only, real_execution, no_crash
**Tier 1 (CRITICAL)**: max_file_lines=200, hot_reloadable, checkpoint_state
**Tier 2 (STANDARD)**: no_duplication, no_hardcoded_values, modularity

**Never**: fake data | write test files | skip pre-emit testing | skip post-emit validation | leave docs-code desync | defer spotted issues | advance with failing gate | comments in code | hardcoded values

**Always**: pre-emit test before writing | post-emit validate after writing | dual-side validation for full-stack | self-check every file | reconcile docs | fix issues immediately | ground truth only

---

**→ NEXT**: When all gate conditions pass and post-emit validation succeeds, invoke `gm-complete` skill for end-to-end verification and git enforcement.
