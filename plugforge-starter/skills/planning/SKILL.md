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

**EXIT — invoke `gm-execute` skill immediately when**:
- Zero new unknowns discovered in the latest reasoning pass
- All .prd items have explicit acceptance criteria
- All dependencies are mapped bidirectionally
- Do NOT advance while unknowns remain discoverable through reasoning alone

**SELF-LOOP (remain in PLAN state)**:
- Each planning pass surfaces new unknowns → add them to .prd → plan again
- Loop until a full pass produces zero new items

**REGRESSION ENTRIES (this skill is re-entered from later states)**:
- From EXECUTE state: execution reveals an unknown not in .prd → add it, re-plan, re-advance
- From EMIT state: scope shifted mid-write → revise affected items, re-plan, re-advance
- From VERIFY state: end-to-end reveals wrong requirement → rewrite items, re-plan, re-advance

## WHAT PLANNING MEANS

Planning = exhaustive fault-surface enumeration. For every aspect of the task, apply diagnostic questioning:
- What do I not know? → name it as a mutable (UNKNOWN)
- What could go wrong? → name it as an edge case item with a failure mode
- What depends on what? → map blocking/blockedBy explicitly
- What assumptions am I making? → each assumption is an unwitnessed hypothesis = mutable until proven by execution

**Iterate until**: a full reasoning pass adds zero new items to .prd. Every item must have an acceptance criterion that is binary and measurable — no subjective criteria.

Fault surfaces to enumerate exhaustively: file existence | API shape | data format | dependency versions | runtime behavior | environment differences | error conditions | concurrency hazards | integration seams | backwards compatibility | rollback paths | deployment steps | verification criteria | CI/CD pipeline correctness

**MANDATORY CODEBASE SCAN**: For every planned item, add `existingImpl=UNKNOWN` mutable. Resolve by running exec:codesearch for the concern (not the implementation). If existing code serves the same concern → the .prd item becomes a consolidation task, not an addition. The plan restructures existing code to absorb the new requirement — never bolt new code alongside existing code that does related work.

## OBSERVABILITY ENUMERATION

During every planning pass, enumerate every possible observability improvement for the app under change:

**Server-side**: Does every internal state machine, queue, cache, and connection pool expose a real-time inspection API or log? Can any internal state be queried without restarting? Are profiling hooks present for hot paths?

**Client-side**: Does `window.__debug` (or equivalent) expose every piece of state, every log entry, every active request, every rendered component's props? Nothing hidden from the agent — full execution transparency at all times.

**Mandate**: On discovery of any observability gap → immediately add a .prd item for it. Observability improvements are highest-priority — never deferred, never skipped. The agent must be able to see specifically anything it wants, and nothing should require a guess.

## .PRD FORMAT

Path: exactly `./.prd` in current working directory. **JSON array** written via `exec:nodejs`.

**Delete the file when empty.** Do not leave an empty `.prd` on disk — remove it entirely when all items are completed.

```json
[
  {
    "id": "descriptive-kebab-id",
    "subject": "Imperative verb phrase — what must be true when done",
    "status": "pending",
    "description": "Precise completion criterion",
    "effort": "small|medium|large",
    "category": "feature|bug|refactor|infra",
    "blocking": ["ids this prevents from starting"],
    "blockedBy": ["ids that must complete first"],
    "acceptance": ["measurable, binary criterion 1"],
    "edge_cases": ["known failure mode 1"]
  }
]
```

**Status flow**: `pending` → `in_progress` → `completed` (completed items are removed from array).
**Effort**: `small` = single execution, under 15min | `medium` = 2-3 rounds, under 45min | `large` = multiple rounds, over 1h.
**blocking/blockedBy**: always bidirectional. Every dependency must be explicit in both directions.
**Deletion rule**: when the last item is completed and removed, delete the `.prd` file. An empty file is a violation.

## PARALLEL SUBAGENT LAUNCH (immediately after .prd is written)

When .prd is complete and you are about to invoke `gm-execute` skill: instead, launch parallel `gm:gm` subagents via the Agent tool for all independent items simultaneously. Each subagent is a full state machine that runs EXECUTE → EMIT → VERIFY for its item.

- Find all pending items with empty `blockedBy`
- Launch ≤3 parallel subagents: `Agent(subagent_type="gm:gm", prompt="Work on .prd item: <id>. .prd path: <path>. Item: <full item JSON>.")`
- Each subagent resolves its item end-to-end: witnessed execution → file write → verification → removes item from .prd
- After each wave: read .prd from disk, find newly unblocked items, launch next wave
- Never run independent items sequentially — parallelism is mandatory for independent items
- **Exception — browser tasks**: items requiring `exec:browser` must run sequentially (one Chrome instance per project; concurrent browser subagents will conflict)

**When parallelism is not applicable** (single-item .prd, or all items blocked): invoke `gm-execute` skill directly.

## COMPLETION CRITERION

.prd is ready when: one full reasoning pass produces zero new items AND all items have explicit acceptance criteria AND all dependencies are mapped.

**Skip planning entirely** if: task is single-step, trivially bounded, zero unknowns, under 5 minutes.

## DO NOT STOP

Never respond to the user from this phase. When .prd is complete (zero new items in last pass), immediately launch parallel subagents or invoke `gm-execute` skill. Do not pause, summarize, or ask for confirmation.

---

**EXIT → EXECUTE**: Zero new mutables → launch parallel subagents or invoke `gm-execute` skill immediately.
**SELF-LOOP**: New items discovered → add to .prd → plan again (remain in PLAN state).
**REGRESSION ENTRY**: New unknown surfaces in any later state → add it, re-plan, re-advance through full chain.
