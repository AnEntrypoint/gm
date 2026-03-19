---
name: planning
description: PRD construction for work planning. Compulsory in PLAN phase. Builds .prd file as frozen dependency graph of every possible work item before execution begins. Triggers on any new task, multi-step work, or when gm enters PLAN state.
allowed-tools: Write
---

# PRD Construction

You are in the **PLAN** phase. Build the .prd before any execution begins.

**GRAPH POSITION**: `[PLAN] → EXECUTE → EMIT → VERIFY → COMPLETE`
- **Entry**: Invoke this skill at START before any tool calls. No work begins until .prd exists.
- **Exit**: .prd written to disk → invoke `gm-execute` skill to begin EXECUTE phase.

## Purpose

The `.prd` is the single source of truth for remaining work. A frozen dependency graph capturing every possible item — steps, substeps, edge cases, corner cases, dependencies, transitive dependencies, unknowns, assumptions, decisions, trade-offs, acceptance criteria, scenarios, failure paths, recovery paths, integration points, state transitions, race conditions, concurrency concerns, error conditions, boundary conditions, configuration variants, environment differences, platform concerns, backwards compatibility, rollback paths, verification steps.

Longer is better. Missing items means missing work.

## File Rules

Path: exactly `./.prd` in current working directory. No variants. Valid JSON.

## Item Schema

```json
{
  "id": "descriptive-kebab-id",
  "subject": "Imperative verb describing outcome",
  "status": "pending",
  "description": "What must be true when this is done",
  "blocking": ["ids-this-prevents"],
  "blockedBy": ["ids-that-must-finish-first"],
  "effort": "small|medium|large",
  "category": "feature|bug|refactor|docs|infra",
  "acceptance": ["measurable criteria"],
  "edge_cases": ["known complications"]
}
```

**Subject**: imperative form — "Fix auth bug", "Add webhook support". Never "Bug: auth".
**Status**: `pending` → `in_progress` → `completed`. No other values.
**Effort**: `small` (<15min) | `medium` (<45min) | `large` (1h+).
**Blocking/blockedBy**: bidirectional. Every dependency explicit.

## Construction

1. Enumerate every possible unknown as a work item.
2. Map every possible dependency (blocking/blockedBy).
3. Group independent items into parallel waves (max 3 per wave).
4. Capture every edge case as either a separate item or edge_case field.
5. Write `./.prd` to disk.
6. **FREEZE** — no additions after creation. Only mutation: removing finished items.

## Execution

1. Find all `pending` items with empty `blockedBy`.
2. Launch ≤3 parallel subagents (`subagent_type: gm:gm`) per wave.
3. Each subagent completes one item, verifies via witnessed execution.
4. On completion: remove item from `.prd`, write updated file.
5. Check for newly unblocked items. Launch next wave.
6. Continue until `.prd` is empty.

Never execute independent items sequentially. Never launch more than 3 at once.

## Completion

`.prd` must be empty at COMPLETE. The stop hook blocks session end when items remain.

## Do Not Use

Skip this skill if the task is trivially single-step (under 5 minutes, no dependencies, no unknowns).

---

**→ NEXT**: .prd written → invoke `gm-execute` skill to begin EXECUTE phase.
