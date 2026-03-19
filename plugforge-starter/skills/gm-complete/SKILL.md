---
name: gm-complete
description: VERIFY and COMPLETE phase. End-to-end verification, completion definition, git enforcement. Invoke after EMIT gates pass.
---

# GM COMPLETE — Verification and Completion

You are in the **VERIFY → COMPLETE** phase. Files are written and validated. Now prove the system works end-to-end and enforce git discipline.

**GRAPH POSITION**: `PLAN → EXECUTE → EMIT → [VERIFY → COMPLETE]`
- **Session entry chain**: prompt-submit hook → `gm` skill → `planning` → `gm-execute` → `gm-emit` → `gm-complete` skill (here). The `gm` skill contract is active: state machine, mutable discipline, ground truth only, git enforcement.
- **Entry**: All EMIT gate conditions passed and files written to disk.
- **Loop**: If .prd items remain after verification → invoke `gm-execute` skill for next wave.
- **Done**: .prd empty + git clean + all pushes confirmed → COMPLETE.

## MUTABLE DISCIPLINE

- `witnessed_execution=UNKNOWN` until real end-to-end run produces witnessed output
- `git_clean=UNKNOWN` until `git status --porcelain` returns empty
- `git_pushed=UNKNOWN` until `git rev-list --count @{u}..HEAD` returns 0
- `prd_empty=UNKNOWN` until .prd has zero items

All four must resolve to KNOWN before COMPLETE. Any UNKNOWN = absolute barrier.

## END-TO-END VERIFICATION

Run the real system end-to-end. Witness it working.

Verification = executed system with witnessed working output. NOT verification: marker files, documentation updates, status text, declaring ready, saying done, checkmarks, screenshots alone.

- Run modified code with real data via `exec:nodejs` with real imports
- Test success paths, failure scenarios, edge cases
- For browser/UI: `agent-browser` skill with real workflows
- **DUAL-SIDE**: server + client features require both `exec:nodejs` AND `agent-browser` tests

## TOOL REFERENCE

**`exec:<lang>`** — Bash tool: `exec:<lang>\n<code>`. Languages: `exec:nodejs` (default) | `exec:python` | `exec:bash` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:java` | `exec:deno` | `exec:cmd`. Lang auto-detected. Bash: only git directly. All else via exec interception.

**`agent-browser`** — Invoke `agent-browser` skill. Escalation: (1) `exec:agent-browser\n<js>` first → (2) skill + `__gm` globals → (3) navigate/click → (4) screenshot last resort.

**`process-management`** — Invoke `process-management` skill. Clean up all processes before COMPLETE. Orphaned PM2 processes = gate violation.

## GIT ENFORCEMENT

Before reporting any work as complete, ALL changes must be committed AND pushed.

**Checklist**:
1. `git status --porcelain` → empty (no uncommitted changes)
2. `git rev-list --count @{u}..HEAD` → 0 (no unpushed commits)
3. `git add -A` → `git commit -m "description"` → `git push` → verify

Local commits without push ≠ complete.

## COMPLETION DEFINITION

Completion = ALL of:
- Witnessed execution with real output
- Every scenario tested (success, failure, edge, corner, error, recovery)
- `user_steps_remaining=0` — no handoffs, no partial states
- .prd empty — zero pending, zero in_progress items
- Git clean and pushed
- All processes cleaned up

## NO PREMATURE STOPPING

Do not stop when you think it works. Keep going until:
- Every .prd item removed
- Every edge case witnessed
- Every push confirmed
- `git status --porcelain` is empty

After every success: enumerate what remains. Execute all remaining items before reporting.

## GROUND TRUTH

Real services only. On discovering mocks/fakes/stubs: delete immediately, implement real paths.

## CONSTRAINTS (VERIFY/COMPLETE-PHASE)

**Never**: claim done without witnessed execution | leave uncommitted changes | leave unpushed commits | leave .prd items remaining | leave orphaned processes | partial completion | handoffs to user | stop at first green

**Always**: witnessed end-to-end execution | git add + commit + push + verify | empty .prd before done | clean up all processes | enumerate remaining after every success

---

**→ LOOP**: .prd items remain → invoke `gm-execute` skill for next wave.
**→ DONE**: .prd empty + git clean → COMPLETE.
