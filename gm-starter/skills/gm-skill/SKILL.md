---
name: gm-skill
description: AI-native software engineering harness. Every action routes through plugkit via the spool. The agent dispatches verbs; plugkit owns phase, mutables, PRD, recall, instructions, the three-layer filter (cost → bounds → direction), and every other concern.
allowed-tools: Skill, Read, Write, Bash(node *), Bash(bun *)
---

# gm — only plugkit

Plugkit owns the discipline. Every turn, dispatch the `instruction` verb and follow the prose it returns. Every candidate operation runs through the three-layer filter plugkit serves: L1 cost (measure before acting) → L2 bounds (keep state finite) → L3 direction (verify toward goal). Any reject defers or discards. Read/Edit/Bash/Grep/Glob before the first `instruction` dispatch is the failure mode this skill prevents — every one of those is a step taken outside the loop, and the loop is the work.

If `.gm/exec-spool/.status.json` is absent or its `ts` is older than 15s, boot the watcher first — the one thing this skill does directly, because nothing else can be served until the spool is alive:

```
bun x gm-plugkit@latest spool > /dev/null 2>&1 &
```

(`npx -y gm-plugkit@latest spool > /dev/null 2>&1 &` if `bun` is missing.) Wait 2s, confirm `.status.json` heartbeat is fresh, then proceed.

Now dispatch `instruction` by writing an empty body to `.gm/exec-spool/in/instruction/<N>.txt` and reading the response from `.gm/exec-spool/out/instruction-<N>.json`. The response carries the active phase prose, the PRD, the open mutables, prior recall, the three-layer framing for the phase, and every signal that should shape the next action. Follow that prose imperatively. When its exit condition is met, dispatch `transition`. The chain runs PLAN → EXECUTE → EMIT → VERIFY → COMPLETE under plugkit's direction; this skill does not duplicate the prose, does not enumerate verbs, does not describe the dispatch format — plugkit serves all of it on demand.

Nothing else lives here. Every concern that feels like it belongs in this file — how to batch, what verbs exist, when to scan for residuals, how the browser surface works, where the watcher logs go, how updates land, when to stop, which closure shapes are forbidden — is served by `instruction` when the moment calls for it. Trying to remember it from this skill instead of asking plugkit is forced closure: the agent acts on a stale snapshot of policy instead of the live one plugkit holds.

Memory writes route through `memorize-fire` only. Questions to the user fire last — after the three layers, scope-expansion, and a `WebSearch`/`WebFetch` pack have all closed empty. `AskUserQuestion` mid-iteration to pick between viable approaches IS the L3 violation the filter rejects (low-cost narrative substituting for an audited mutation).

Only plugkit.
