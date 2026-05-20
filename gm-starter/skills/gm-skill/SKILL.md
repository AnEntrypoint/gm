---
name: gm-skill
description: AI-native engineering harness. Plugkit-served instruction stream; three-layer admission filter (cost, bounds, direction) gates every mutation; PRD-DAG covers the destructive transform's closure; emit the mature artifact, not the scaffold.
allowed-tools: Skill, Read, Write, Bash(node *), Bash(bun *)
---

# gm — only plugkit

Plugkit owns the discipline. Every turn: dispatch `instruction`, follow the prose. Every candidate operation traverses the three-layer admission filter — L1 cost (empirical baseline; recall+codesearch fan-out probes it) → L2 bounds (`|F|=1` single-writer per surface; PRD/mutables/KV are the central stores) → L3 direction (Lyapunov criterion; mutations must monotonically decrease distance-to-goal; audit tuple `(id, hash, ts)` per accepted write). Reject → defer or discard.

Read/Edit/Bash/Grep/Glob before the first `instruction` dispatch IS the failure this skill prevents — each is a step outside the loop, and the loop is the work.

If `.gm/exec-spool/.status.json` is absent or stale (>15s), boot the watcher — the one direct action this skill permits:

```
bun x gm-plugkit@latest spool > /dev/null 2>&1 &
```

(`npx -y gm-plugkit@latest spool > /dev/null 2>&1 &` if `bun` missing.) Wait 2s, confirm fresh heartbeat, proceed.

Now dispatch `instruction` (empty body → `in/instruction/<N>.txt`). Response carries the active phase prose, PRD, open mutables, prior recall, the three-layer framing for this phase, and every signal the next action needs. Follow imperatively. Exit condition met → `transition`. Chain runs PLAN → EXECUTE → EMIT → VERIFY → COMPLETE under plugkit's direction; this skill does not duplicate prose, enumerate verbs, or describe the dispatch ABI — plugkit serves all of it on demand.

Maturity-first invariant: emit the closure of the destructive transform the request admits, not a scaffold + "Phase 2 next session" IOU. Partial emits are non-monotonic, L3-rejected. If closure exceeds session reach, that's a Maximal Cover decomposition (PRD-DAG enumeration), never a TODO-launder.

Memory writes route through `memorize-fire` only — native memory surfaces are invisible to recall and forbidden. Questions to user fire last, after the three layers, scope-expansion, and a `WebSearch`/`WebFetch` pack all close empty. `AskUserQuestion` mid-iteration to pick between viable approaches IS the L3 violation the filter rejects (low-cost narrative substituting for an audited mutation).

Only plugkit.
