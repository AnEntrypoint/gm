---
name: gm-continue
description: Works out what is left in gm-new from its rows, plans the whole batch of actionable rows, hands the batch to the gm skill, and calls the gm skill again while actionable rows remain. Use to continue gm-new work from its rows.
---

# gm-continue

1. Setup. Before any work starts, run tools/gm-continue-setup.mjs. It reads the rows only, plans the whole batch of actionable rows (status open, not owner-owned, trigger met), and prints the plan. Nothing is worked before the plan is printed. Independent items in the batch are worked in parallel.
2. Build, then witness. The whole batch is built first, all steps, and then witnessed in one pass over all of them. The commits land after that pass. Each step's witness is recorded in the run log and cited in DESIGN.md. A step is not witnessed on its own during the build.
3. Hand off. Call the gm skill with the setup's list as its task. The gm skill's task is the setup output, and nothing else.
4. Re-enter. After the gm skill returns, call the gm skill again while actionable items remain. This is an invariant of this skill. Re-entry stops after any pass that closes no row, and only when every actionable row was attempted and ended resolved, or blocked with a named fact. Any other actionable row is a defect, and the setup reports it.
5. End. The end prints the handoff only after the witness pass has run. The handoff lists each blocked item with its reason, each decision the owner must make, each held item with its trigger, HEAD and the served hashes, the open runs and processes, and the next actions in order. Print it even when the list is empty.

The setup is read-only. It writes nothing, commits nothing and changes no served behaviour. No new tool names are used.
