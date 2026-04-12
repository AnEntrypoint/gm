---
name: gm-complete
description: VERIFY and COMPLETE phase. End-to-end system verification and git enforcement. Any new unknown triggers immediate snake back to planning — restart chain.
---

# GM COMPLETE — Verification and Completion

You are in the **VERIFY → COMPLETE** phase. Files are written. Prove the whole system works end-to-end. Any new unknown = snake to `planning`, restart chain.

**GRAPH POSITION**: `PLAN → EXECUTE → EMIT → [VERIFY] → UPDATE-DOCS → COMPLETE`
- **Entry**: All EMIT gates passed. Entered from `gm-emit`.

## TRANSITIONS

**EXIT — .prd items remain**: Verified items completed, .prd still has pending items → invoke `gm-execute` skill immediately (next wave). Do not stop.

**EXIT — COMPLETE**: .prd empty + all work pushed + CI green → invoke `update-docs` skill.

**STATE REGRESSIONS**:
- Verification reveals broken file output → invoke `gm-emit` skill, reset to EMIT state, re-verify on return
- Verification reveals logic error → invoke `gm-execute` skill, reset to EXECUTE state, re-emit and re-verify on return
- Verification reveals new unknown → invoke `planning` skill, reset to PLAN state
- Verification reveals wrong requirements → invoke `planning` skill, reset to PLAN state

**TRIAGE on failure**: broken file output → regress to `gm-emit` | wrong logic → regress to `gm-execute` | new unknown or wrong requirements → regress to `planning`

**RULE**: Any surprise = new unknown = regress to `planning`. Never patch around surprises.

## MUTABLE DISCIPLINE

- `witnessed_e2e=UNKNOWN` until real end-to-end run produces witnessed output
- `git_clean=UNKNOWN` until `exec:bash\ngit status --porcelain` returns empty
- `git_pushed=UNKNOWN` until `git log origin/main..HEAD --oneline` returns empty
- `ci_passed=UNKNOWN` until all GitHub Actions runs triggered by the push reach `conclusion: success`
- `prd_empty=UNKNOWN` until .prd file is deleted (not just empty — file must not exist)

All five must resolve to KNOWN before COMPLETE. Any UNKNOWN = absolute barrier.

## END-TO-END DIAGNOSTIC VERIFICATION

Run the real system with real data. Witness actual output. This is a full-system fault-detection pass.

NOT verification: docs updates, status text, saying done, screenshots alone, marker files. Unwitnessed claims are inadmissible.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

**Failure triage protocol**: when end-to-end fails, do not patch blindly. Isolate the fault:
1. Identify which subsystem produced the unexpected output
2. Reproduce the failure in isolation (single function, single module)
3. Name the delta between expected and actual — this is the mutable
4. Triage: broken file output → regress to EMIT | wrong logic → regress to EXECUTE | new unknown → regress to PLAN
5. Never fix a symptom without identifying and fixing the root cause

For browser/UI: invoke `browser` skill with real workflows. Server + client features require both exec:nodejs AND browser diagnostics. After every success: enumerate what remains — never stop at first green. First green is not COMPLETE.

## CODE EXECUTION

**exec:<lang> is the only way to run code.** Bash tool body: `exec:<lang>\n<code>`

`exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:java` | `exec:deno` | `exec:cmd`

Only git in bash directly. Background tasks: `exec:sleep\n<id>`, `exec:status\n<id>`, `exec:close\n<id>`. Runner: `exec:runner\nstart|stop|status`.

**Execution efficiency — pack every run:**
- Combine multiple independent operations into one exec call using `Promise.allSettled` or parallel subprocess spawning
- Each independent idea gets its own try/catch with independent error reporting — never let one failure block another
- Target under 12s per exec call; split work across multiple calls only when dependencies require it
- Prefer a single well-structured exec that does 5 things over 5 sequential execs

## CODEBASE EXPLORATION

```
exec:codesearch
<natural language description>
```

## GIT ENFORCEMENT

```
exec:bash
git status --porcelain
```
Must return empty.

```
exec:bash
git log origin/main..HEAD --oneline
```
Must return empty. If not: stage → commit → push → re-verify. Local commit without push ≠ complete.

## CI ENFORCEMENT

After push, monitor all triggered GitHub Actions runs until they complete:

1. List runs triggered by the push:
```
exec:bash
gh run list --limit 5 --json databaseId,name,status,conclusion,headBranch
```

2. For each run that is `in_progress` or `queued`, poll until it completes:
```
exec:bash
gh run watch <run_id> --exit-status
```

3. If a run fails, view the logs to diagnose:
```
exec:bash
gh run view <run_id> --log-failed
```

4. Fix the root cause → snake to the appropriate phase (emit for file issues, execute for logic issues, planning for new unknowns) → re-push → re-monitor.

5. All runs must reach `conclusion: success` before advancing. A failed CI run is a KNOWN mutable that blocks completion — never ignore it.

**Cascade awareness**: pushes to this repo may trigger downstream workflows (see CLAUDE.md Rust Binary Update Pipeline). After local CI passes, check downstream repos for triggered runs:
```
exec:bash
gh run list --repo AnEntrypoint/<downstream-repo> --limit 3 --json databaseId,name,status,conclusion
```
Monitor any cascade runs the same way — poll, diagnose failures, fix if the cause is in this repo.

## CODEBASE HYGIENE SWEEP

Before declaring complete, sweep the entire codebase for violations:

1. **Files >200 lines** → split immediately
2. **Comments in code** → remove all
3. **Test files** (.test.js, .spec.js, __tests__/) → delete
4. **Mock/stub/simulation files** → delete
5. **Unnecessary doc files** (not CHANGELOG/CLAUDE/README/TODO.md) → delete
6. **Duplicate concern** (overlapping responsibility, similar logic, parallel implementations, consolidatable code) → snake to `planning` with restructuring instructions — do not patch locally
7. **Hardcoded values** → derive from ground truth, config, or convention
8. **Fallback/demo modes** → remove, fail loud instead
9. **TODO.md** → must be empty/deleted before completion
10. **CHANGELOG.md** → must have entries for this session's changes
11. **Observability gaps** → every server subsystem added this session exposes a `/debug/<subsystem>` endpoint; every client module added this session registers into `window.__debug` by key. Ad-hoc console.log is not observability — permanent queryable structures are. Any gap found → fix before advancing.
12. **memorize** → launch memorize sub-agent in background with session learnings before invoking update-docs: `Agent(subagent_type='memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<session learnings>')`
13. **Deploy/publish** → if deployable, deploy. If npm package, publish.

Any violation found = fix immediately before advancing.

## COMPLETION DEFINITION

All of: witnessed end-to-end output | all failure paths exercised | .prd empty | git clean and pushed | all CI runs green | codebase hygiene sweep clean | TODO.md empty/deleted | CHANGELOG.md updated | `user_steps_remaining=0`

## DO NOT STOP

After end-to-end verification passes: read .prd from disk. If any items remain, immediately invoke `gm-execute` skill — do not respond to the user. Only respond when .prd is deleted AND git is clean AND all commits are pushed.

## CONSTRAINTS

**Never**: claim done without witnessed output | uncommitted changes | unpushed commits | failed CI runs | .prd items remaining | TODO.md with items remaining | stop at first green | absorb surprises silently | respond to user while .prd has items | skip hygiene sweep | leave comments/mocks/test files/fallbacks

**Always**: triage failure before regressing | witness end-to-end | regress to planning on any new unknown | enumerate remaining after every success | check .prd after every verification pass | run hygiene sweep before declaring complete | deploy/publish if applicable | update CHANGELOG.md

---

**EXIT → EXECUTE**: .prd items remain → invoke `gm-execute` skill immediately (keep going, never stop with .prd items).
**EXIT → COMPLETE**: .prd deleted + feature work pushed + CI green → invoke `update-docs` skill.
**REGRESS → EMIT**: file output wrong → invoke `gm-emit` skill, reset to EMIT state.
**REGRESS → EXECUTE**: logic wrong → invoke `gm-execute` skill, reset to EXECUTE state.
**REGRESS → PLAN**: new unknown or wrong requirements → invoke `planning` skill, reset to PLAN state.
