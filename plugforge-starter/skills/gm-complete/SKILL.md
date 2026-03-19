---
name: gm-complete
description: VERIFY and COMPLETE phase. End-to-end verification, completion definition, git enforcement. Invoke after EMIT gates pass.
---

# GM COMPLETE — Verification and Completion

You are in the **VERIFY → COMPLETE** phase. Files are written and validated. Now prove the system works end-to-end and enforce git discipline.

**GRAPH POSITION**: `PLAN → EXECUTE → EMIT → [VERIFY → COMPLETE]`
- **Entry**: All EMIT gate conditions passed. Files written and post-emit validated.
- **Exit (COMPLETE)**: `gate_passed=true` AND `user_steps_remaining=0` AND git clean AND .prd empty.
- **Loop**: If .prd items remain after verification → invoke `gm-execute` skill for next wave.
- **Done**: When .prd is empty, git status clean, all pushes confirmed → work is COMPLETE.

## MUTABLE DISCIPLINE

- `witnessed_execution=UNKNOWN` until real end-to-end run produces witnessed output
- `git_clean=UNKNOWN` until `git status --porcelain` returns empty
- `git_pushed=UNKNOWN` until `git rev-list --count @{u}..HEAD` returns 0
- `prd_empty=UNKNOWN` until .prd has zero items
- All four must resolve to KNOWN before COMPLETE. Any UNKNOWN = absolute barrier.
- State-tracking mutables live in conversation only. Never written to files.

## END-TO-END VERIFICATION

Run the real system end-to-end. Witness it working.

**Verification = executed system with witnessed working output.** These are NOT verification: marker files, documentation updates, status text, declaring ready, saying done, checkmarks, screenshots alone. Only executed output you witnessed working is proof.

Execute via `exec:<lang>` or `agent-browser` skill:
- Run modified code with real data
- Test success paths, failure scenarios, edge cases
- Witness actual console output or return values
- For browser/UI features: `agent-browser` skill with real workflows
- For backend features: `exec:nodejs` with real imports and real data

**DUAL-SIDE**: If feature spans server + client, both `exec:nodejs` server tests AND `agent-browser` client tests required. Neither substitutes. Single-side = UNKNOWN.

When approach fails: revise the approach, never declare the goal impossible. Failing an approach falsifies that approach, not the objective.

## COMPLETION DEFINITION

Completion = ALL of:
- Witnessed execution with real output
- Every scenario tested (success, failure, edge, corner, error, recovery, concurrent, timing)
- Goal achieved and proven
- Gate conditions passed
- `user_steps_remaining=0` — no handoffs, no partial states, no "here is how", no "now you can"
- .prd empty — zero pending, zero in_progress items
- Git clean and pushed

Last 1% of work requires 99% of effort. Partial/ready/prepared states mean nothing.

If a step cannot complete due to genuine constraints: state explicitly what and why. Never pretend. Never skip silently.

## NO PREMATURE STOPPING

Do not stop when you think it works. Do not stop when the main path succeeds. Do not stop after the first green output.

Keep going until:
- Every .prd item is removed
- Every edge case is witnessed
- Every platform is rebuilt
- Every push is confirmed
- `git status --porcelain` is empty

"Looks good" is not done. "Should work" is not done. "I believe it's complete" is not done.

**After every success**: enumerate what remains. Every witnessed success is a prompt to execute the next item, not a reason to report. After each green output ask: what .prd items are still open? What edge cases unexecuted? What downstream effects unverified? Execute all of them.

The best run keeps going past the obvious finish line, catches the edge case that would surface in production, verifies the downstream effect nobody asked about, and pushes before reporting. A complete session ends with the user reading results, not instructions. Deliver results the user only needs to read.

## GIT ENFORCEMENT

Before reporting any work as complete, ALL changes must be committed AND pushed.

**Checklist** (must all pass):
- `git status --porcelain` → empty (no uncommitted changes)
- `git rev-list --count @{u}..HEAD` → 0 (no unpushed commits)
- `git rev-list --count HEAD..@{u}` → 0 (no unmerged upstream, or handle gracefully)

**Sequence**:
1. `git add -A` to stage all changes
2. `git commit -m "description"` with meaningful message
3. `git push` to remote
4. Verify push succeeded

Local commits without push ≠ complete. Applies to ALL platforms.

## GROUND TRUTH

Real services, real API responses, real timing only. On discovering mocks/fakes/stubs: delete immediately, implement real paths, verify with real data. Unit testing forbidden: no .test.js/.spec.js, no test dirs, no mock files. Delete on discovery. Verify via `exec:<lang>` with actual services only.

## TOOL REFERENCE

**`exec:<lang>`** — `exec:nodejs` (default) | `exec:python` | `exec:bash` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`. Lang auto-detected. `cwd` sets directory. Bash: only `git` directly. All else via exec interception. Post-exec: `exec:bash\ngit status --porcelain` must be empty.

**`agent-browser`** — Escalation: (1) `exec:agent-browser\n<js>` first → (2) skill + `__gm` globals → (3) navigate/click → (4) screenshot last resort.

**`code-search`** — MANDATORY for all exploration. Glob/Grep/Explore blocked.

**`process-management`** — Clean up all processes before completion. Orphaned PM2 processes = gate violation.

## CONSTRAINTS (VERIFY/COMPLETE-PHASE)

**Tier 0 (ABSOLUTE)**: ground_truth_only, real_execution, no_crash, verification_witnessed
**Tier 1 (CRITICAL)**: all changes committed and pushed, .prd empty

**Never**: fake data | claim done without witnessed execution | leave uncommitted changes | leave unpushed commits | leave .prd items remaining | leave orphaned processes | partial completion | handoffs to user | stop at first green | skip edge cases | pretend incomplete work was complete | stop for context limits | marker files as completion

**Always**: witnessed end-to-end execution | git add + commit + push + verify | empty .prd before done | clean up all processes | enumerate remaining work after every success | keep going until truly done | deliver results user only needs to read | fix issues immediately on sight

---

**→ NEXT**: If .prd items remain → invoke `gm-execute` skill for next execution wave. If .prd is empty AND git is clean → COMPLETE. Work is done.
