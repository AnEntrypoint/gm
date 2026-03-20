---
name: gm-complete
description: VERIFY and COMPLETE phase. End-to-end system verification, git enforcement, completion gate. Invoke after EMIT gates pass. Snake back to EMIT or EXECUTE if verification reveals failures.
---

# GM COMPLETE — Verification and Completion

You are in the **VERIFY → COMPLETE** phase. Files are written. Now prove the whole system works and enforce git discipline.

**GRAPH POSITION**: `PLAN → EXECUTE → EMIT → [VERIFY → COMPLETE]`
- **Entry chain**: prompt-submit hook → `gm` skill → `planning` → `gm-execute` → `gm-emit` → `gm-complete` (here).

## TRANSITIONS

**FORWARD (ladders)**:
- .prd items remain → invoke `gm-execute` skill for next wave (new items unblocked)
- .prd empty + git clean + all pushed → COMPLETE

**BACKWARD (snakes) — when to leave this phase**:
- End-to-end reveals broken file (wrong output, crash, bad structure) → snake back: invoke `gm-emit` skill, fix and re-verify the file, return here
- End-to-end reveals logic error not a file issue (wrong algorithm, missing step) → snake back: invoke `gm-execute` skill, re-resolve mutables, re-emit, return here
- End-to-end reveals requirements were wrong → snake back: invoke `planning` skill, revise .prd, restart cycle

**WHEN TO SNAKE TO EMIT**: output is wrong but the logic was right — file needs rewriting
**WHEN TO SNAKE TO EXECUTE**: algorithm is wrong — needs re-debugging before re-writing
**WHEN TO SNAKE TO PLAN**: requirements changed or were misunderstood

## MUTABLE DISCIPLINE

- `witnessed_execution=UNKNOWN` until real end-to-end run produces witnessed output
- `git_clean=UNKNOWN` until `git status --porcelain` returns empty
- `git_pushed=UNKNOWN` until `git rev-list --count @{u}..HEAD` returns 0
- `prd_empty=UNKNOWN` until .prd has zero items

All four must resolve to KNOWN before COMPLETE. Any UNKNOWN = absolute barrier. Trigger a snake if stuck.

## END-TO-END VERIFICATION

Run the real system. Witness it working with real data and real interactions.

Verification = witnessed system output. NOT verification: marker files, docs updates, status text, saying done, screenshots alone.

- `exec:nodejs` with real imports and real data — witness success paths and failure paths
- For browser/UI: `agent-browser` skill with real workflows
- Dual-side: server + client features require both `exec:nodejs` AND `agent-browser`

If verification fails: identify whether it's a file issue (→ snake to EMIT) or logic issue (→ snake to EXECUTE).

## TOOL REFERENCE

**`exec:<lang>`** — Bash tool: `exec:<lang>\n<code>`. `exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:java` | `exec:deno` | `exec:cmd`. Only git directly in bash.

**`agent-browser`** — Invoke `agent-browser` skill. Escalation: (1) `exec:agent-browser\n<js>` → (2) skill + `__gm` globals → (3) navigate/click → (4) screenshot last resort.

**`process-management`** — Invoke `process-management` skill. Clean up all processes before COMPLETE. Orphaned PM2 = gate violation.

## GIT ENFORCEMENT

All changes committed AND pushed before COMPLETE.

1. `exec:bash\ngit status --porcelain` → must be empty
2. `exec:bash\ngit rev-list --count @{u}..HEAD` → must be 0
3. If not: `git add -A` → `git commit -m "..."` → `git push` → re-verify both

Local commit without push ≠ complete.

## COMPLETION DEFINITION

All of: witnessed end-to-end execution | every failure path debugged | `user_steps_remaining=0` | .prd empty | git clean and pushed | all processes cleaned up

Do not stop when it first works. Enumerate what remains after every success. Execute all remaining items.

## CONSTRAINTS

**Never**: claim done without witnessed execution | uncommitted changes | unpushed commits | .prd items remaining | orphaned processes | handoffs to user | stop at first green

**Always**: witness end-to-end | git commit + push + verify | empty .prd before done | clean processes | enumerate remaining after every success | snake back on failure

---

**→ FORWARD**: .prd items remain → invoke `gm-execute` skill for next wave.
**→ DONE**: .prd empty + git clean → COMPLETE.
**↩ SNAKE to EMIT**: file broken → invoke `gm-emit` skill.
**↩ SNAKE to EXECUTE**: logic wrong → invoke `gm-execute` skill.
**↩ SNAKE to PLAN**: requirements wrong → invoke `planning` skill.
