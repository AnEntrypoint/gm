---
name: data-economy
description: "Keep data moved and stored small: partial clones for history work, delete scratch mirrors after verification, and automate housekeeping instead of adding manual steps"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d196665c-8e22-4a3a-8a93-96e5b7e2c1a4
  modified: 2026-10-24T13:12:19.105Z
---

Minimise the data each flow moves and stores, and automate every step that can run without a person.

**Why:** The user asked for least-data flows and "perfect housecleaning to prevent cumulative data blowup". Scratch mirrors and rewrite attempts grew to about 3.8 GB in one session, and /workspace/gm/.gm reached 898 MB with 589 MB of old lane build directories. Manual steps also multiplied the number of tool calls.

**How to apply:**
- For history-only work, clone blobless (`git clone --mirror --filter=blob:none`). For a pure rewrite of commit messages and authors this is enough. Do not use blobless mirrors for pushes: `pack-objects --thin` fetches each missing blob from the promisor, which made pushes take many minutes. For a push, use a full local mirror, or a mirror cloned with `--reference=<local checkout>` when the checkout already holds the objects.
- Delete scratch mirrors and rewrite attempts as soon as their result is pushed and verified. Keep one rollback bundle of the original state until the work is done, then delete it too.
- gm's `housekeep` verb (gm-mcp 0.2.280+) reports the size of each `.gm` area and prunes only regenerable data: lane-build directories older than 24 hours with no live process, dispatch spills older than 24 hours, and `.bak` copies, which are archived. It never touches gm.db, browser-lease profiles, prd-log, unknowns, or migration markers.
- Prefer a single script over repeated manual steps. Anything that can run automatically should run automatically.
