---
name: gm-complete
description: VERIFY and COMPLETE phase. End-to-end system verification and git enforcement. Any new unknown triggers immediate snake back to planning — restart chain.
---

# GM COMPLETE — Verification and Completion

You are in the **VERIFY → COMPLETE** phase. Files are written. Prove the whole system works end-to-end. Any new unknown = snake to `planning`, restart chain.

**GRAPH POSITION**: `PLAN → EXECUTE → EMIT → [VERIFY → COMPLETE]`
- **Entry**: All EMIT gates passed. Entered from `gm-emit`.

## TRANSITIONS

**FORWARD**:
- .prd items remain → invoke `gm-execute` skill (next wave)
- .prd empty + git clean + all pushed → COMPLETE

**BACKWARD**:
- Verification reveals broken file output → invoke `gm-emit` skill, fix, re-verify, return
- Verification reveals logic error → invoke `gm-execute` skill, re-resolve, re-emit, return
- Verification reveals new unknown → invoke `planning` skill, restart chain
- Verification reveals requirements wrong → invoke `planning` skill, restart chain

**TRIAGE on failure**: broken file output → snake to `gm-emit` | wrong logic → snake to `gm-execute` | new unknown or wrong requirements → snake to `planning`

**RULE**: Any surprise = new unknown = snake to `planning`. Never patch around surprises.

## MUTABLE DISCIPLINE

- `witnessed_e2e=UNKNOWN` until real end-to-end run produces witnessed output
- `git_clean=UNKNOWN` until `exec:bash\ngit status --porcelain` returns empty
- `git_pushed=UNKNOWN` until `exec:bash\ngit rev-list --count @{u}..HEAD` returns 0
- `prd_empty=UNKNOWN` until .prd has zero items

All four must resolve to KNOWN before COMPLETE. Any UNKNOWN = absolute barrier.

## END-TO-END VERIFICATION

Run the real system with real data. Witness actual output.

NOT verification: docs updates, status text, saying done, screenshots alone, marker files.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

For browser/UI: invoke `agent-browser` skill with real workflows. Server + client features require both exec:nodejs AND agent-browser. After every success: enumerate what remains — never stop at first green.

## CODE EXECUTION

**exec:<lang> is the only way to run code.** Bash tool body: `exec:<lang>\n<code>`

`exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:java` | `exec:deno` | `exec:cmd`

Only git in bash directly. Background tasks: `exec:sleep\n<id>`, `exec:status\n<id>`, `exec:close\n<id>`. Runner: `exec:runner\nstart|stop|status`. All activity visible in `pm2 list` and `pm2 monit` in user terminal.

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
git rev-list --count @{u}..HEAD
```
Must return 0. If not: stage → commit → push → re-verify. Local commit without push ≠ complete.

## COMPLETION DEFINITION

All of: witnessed end-to-end output | all failure paths exercised | .prd empty | git clean and pushed | `user_steps_remaining=0`

## CONSTRAINTS

**Never**: claim done without witnessed output | uncommitted changes | unpushed commits | .prd items remaining | stop at first green | absorb surprises silently

**Always**: triage failure before snaking | witness end-to-end | snake to planning on any new unknown | enumerate remaining after every success

---

**→ FORWARD**: .prd items remain → invoke `gm-execute` skill.
**→ DONE**: .prd empty + git clean → COMPLETE.
**↩ SNAKE to EMIT**: file output wrong → invoke `gm-emit` skill.
**↩ SNAKE to EXECUTE**: logic wrong → invoke `gm-execute` skill.
**↩ SNAKE to PLAN**: new unknown or wrong requirements → invoke `planning` skill, restart chain.
