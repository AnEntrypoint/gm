---
name: data-economy
description: "Keep data moved and stored small: partial clones for history work, delete scratch mirrors after verification, and automate housekeeping instead of adding manual steps"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d196665c-8e22-4a3a-8a93-96e5b7e2c1a4
  modified: 2026-10-24T13:12:19.105Z
---
Minimise data each flow move and store. Automate every step no person need.

**Why:** User ask least-data flows, "perfect housecleaning to prevent cumulative data blowup". Scratch mirrors and rewrite attempts hit ~3.8 GB one session. /workspace/gm/.gm hit 898 MB, 589 MB old lane build dirs. Manual steps also multiply tool calls.

**How to apply:**
- History-only work: clone blobless (`git clone --mirror --filter=blob:none`). Pure rewrite of commit messages and authors enough this way. No blobless mirrors for pushes: `pack-objects --thin` fetch each missing blob from promisor, made pushes take many minutes. For push, use full local mirror, or mirror cloned with `--reference=<local checkout>` when checkout already hold objects.
- Delete scratch mirrors and rewrite attempts once result pushed and verified. Keep one rollback bundle of original state until work done, then delete too.
- gm's `housekeep` verb (gm-mcp 0.2.280+) report size of each `.gm` area, prune only regenerable data: lane-build dirs older than 24 hours with no live process, dispatch spills older than 24 hours, and `.bak` copies, which get archived. Never touch gm.db, browser-lease profiles, prd-log, unknowns, or migration markers.
- Prefer single script over repeated manual steps. Anything that can run automatic should run automatic.