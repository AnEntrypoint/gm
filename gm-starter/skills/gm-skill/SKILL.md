---
name: gm-skill
description: Plugkit-served instruction stream. Three-layer admission (cost, bounds, direction) over every mutation. Closure on first emit; partial = non-monotonic.
allowed-tools: Skill, Read, Write, Bash(node *), Bash(bun *)
---

# gm

Every turn: dispatch `instruction`, follow the prose. The discipline lives in plugkit; this file does not duplicate it.

Boot when `.gm/exec-spool/.status.json` is absent or stale (>15s):

```
bun x gm-plugkit@latest spool > /dev/null 2>&1 &
```

(`npx -y gm-plugkit@latest spool > /dev/null 2>&1 &` if `bun` missing.) Heartbeat fresh → dispatch `instruction` — first turn body `{"prompt":"<user request>"}` so orient_nouns and recall_hits derive from the request; subsequent turns may use empty body.

Response body is not a mutation surface. Memory writes route through `memorize-fire` only.
