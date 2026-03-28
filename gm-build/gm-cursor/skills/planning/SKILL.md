---
name: planning
description: Mutable discovery and PRD construction. Invoke at session start and any time new unknowns surface during execution. Loop until no new mutables are discovered.
allowed-tools: Write
---

# PRD Construction — Mutable Discovery Loop

You are in the **PLAN** phase. Your job is to discover every unknown before execution begins.

**GRAPH POSITION**: `[PLAN] → EXECUTE → EMIT → VERIFY → COMPLETE`
- **Entry chain**: prompt-submit hook → `gm` skill → `planning` skill (here).
- **Also entered**: any time a new unknown surfaces in EXECUTE, EMIT, or VERIFY.

## TRANSITIONS

**FORWARD**:
- No new mutables discovered in latest pass → .prd is complete → invoke `gm-execute` skill

**SELF-LOOP (stay in PLAN)**:
- Each planning pass may surface new unknowns → add them to .prd → plan again
- Loop until a full pass produces zero new items
- Do not advance to EXECUTE while unknowns remain discoverable through reasoning alone

**BACKWARD (snakes back here from later phases)**:
- From EXECUTE: execution reveals an unknown not in .prd → snake here, add it, re-plan
- From EMIT: scope shifted mid-write → snake here, revise affected items, re-plan
- From VERIFY: end-to-end reveals requirement was wrong → snake here, rewrite items, re-plan

## WHAT PLANNING MEANS

Planning = exhaustive mutable discovery. For every aspect of the task ask:
- What do I not know? → name it as a mutable
- What could go wrong? → name it as an edge case item
- What depends on what? → map blocking/blockedBy
- What assumptions am I making? → validate each as a mutable

**Iterate until**: a full reasoning pass adds zero new items to .prd.

Categories of unknowns to enumerate: file existence | API shape | data format | dependency versions | runtime behavior | environment differences | error conditions | concurrency | integration points | backwards compatibility | rollback paths | deployment steps | verification criteria

## .PRD FORMAT

Path: exactly `./.prd` in current working directory. **Markdown format** (`.md` content, no extension).

**Delete the file when empty.** Do not leave an empty `.prd` on disk — remove it entirely when all items are completed.

```markdown
# .prd

## pending: descriptive-kebab-id
**Subject:** Imperative verb phrase — what must be true when done
**Status:** pending
**Description:** Precise completion criterion
**Effort:** small|medium|large
**Category:** feature|bug|refactor|infra
**Blocking:** id-a, id-b
**Blocked by:** id-c
**Acceptance:**
- measurable, binary criterion 1
- measurable, binary criterion 2
**Edge cases:**
- known failure mode 1
```

**Status flow**: `pending` → `in_progress` → `completed` (completed items are removed from file).
**Effort**: `small` = single execution, under 15min | `medium` = 2-3 rounds, under 45min | `large` = multiple rounds, over 1h.
**blocking/blockedBy**: always bidirectional. Every dependency must be explicit in both directions.
**Deletion rule**: when the last item is completed and removed, delete the `.prd` file. An empty file is a violation.

## EXECUTION WAVES

Independent items (empty `blockedBy`) run in parallel waves of ≤3 subagents.
- Find all pending items with empty `blockedBy`
- Launch ≤3 parallel `gm:gm` subagents via Task tool
- Each subagent handles one item: resolves it, witnesses output, removes from .prd
- After each wave: check newly unblocked items, launch next wave
- Never run independent items sequentially. Never launch more than 3 at once.

## COMPLETION CRITERION

.prd is ready when: one full reasoning pass produces zero new items AND all items have explicit acceptance criteria AND all dependencies are mapped.

**Skip planning entirely** if: task is single-step, trivially bounded, zero unknowns, under 5 minutes.

## DO NOT STOP

Never respond to the user from this phase. When .prd is complete (zero new items in last pass), immediately invoke `gm-execute` skill. Do not pause, summarize, or ask for confirmation.

---

**→ FORWARD**: No new mutables → invoke `gm-execute` skill immediately.
**↺ SELF-LOOP**: New items discovered → add to .prd → plan again.
**↩ SNAKE here**: New unknown surfaces in any later phase → add it, re-plan, re-advance.
