---
name: gm-continue
description: Works out what is left in gm-new from its rows, plans the whole batch of actionable rows, hands the batch to the gm skill, and calls the gm skill again while actionable rows remain. Use to continue gm-new work from its rows. Load it before every finish of a gm run; it fills the missing rows and writes the run's notes to AGENTS.md and the process skill.
---

# gm-continue

1. Setup. Before any work starts, run tools/gm-continue-setup.mjs. It reads the rows only, plans every open row, reports any row that is neither open nor resolved as a defect, and prints the plan. Nothing is worked before the plan is printed. Independent items in the batch are worked in parallel.
2. Build, then witness. The whole batch is built first, all steps, and then witnessed in one pass over all of them. The commits land after that pass. Each step's witness is recorded in the run log and cited in DESIGN.md. A step is not witnessed on its own during the build.
3. Fill and write notes. Before the hand-off, make the rows match the work, then record what the run learned:
   - For each piece of the task's literal words that no open row covers, add a row with `gm.prd_add`. Check the open list by title first, so a row is not added twice. Run the real path the request names, read its output, and add a row for any mismatch.
   - A project fact that the troubleshooting found goes to AGENTS.md, as one line under "Facts found by troubleshooting", with the DESIGN.md section that records it. A process lesson goes to `skills/dev/SKILL.md`, in the section it belongs to. Delete any AGENTS.md line that needed no troubleshooting to learn, and any line about finished work. Keep AGENTS.md under 30 KB.
   - No row is held. An open row is implemented and resolved with a witness, or, for a PRD the owner has dropped, deleted with `gm.prd_delete({ id })`. An open question is resolved, never deleted.
   - Change the files with Edit only, and commit them by explicit path with `tools/ship.sh`.
4. Hand off. The next step is the gm skill: read skill://gm/SKILL.md with ReadMcpResourceTool (server gm), with the setup's list and what is left as its task. Its task is the setup output and the open rows, and nothing else. Any PRD row still open at this point goes in the hand-off with it.
5. Re-enter. After the gm skill returns, read skill://gm/SKILL.md again with ReadMcpResourceTool (server gm), with what is left as its task, while actionable items remain. This is an invariant of this skill. A pass that closes no row is not a stop: the next step is still the list of what is left, and the gm skill read with it. The loop ends only when every actionable row was attempted and ended resolved, or when a pass closes no row and nothing more can be closed: then `finish` with `stopRows: true`, each open row named in the gaps, and the witness. Any other actionable row is a defect, and the setup reports it.
6. End. The end prints the handoff only after the witness pass has run. The handoff lists the rows the pass resolved, any defect the setup reported, HEAD and the served hashes, the open runs and processes, and the next actions in order. Print it even when the list is empty.

INVARIANT: always read skill://gm/SKILL.md with ReadMcpResourceTool (server gm) when the list is produced, in this same run, with the list and what is left as its task. The next step after the list is the gm skill, never a question to the user. Do not send `finish` while work remains.

The setup is read-only. It writes nothing, commits nothing and changes no served behaviour. The only verbs used are the row verbs, named as `gm.<verb>`: `gm.prd_add`, `gm.prd_resolve`, `gm.prd_delete` and `gm.prd_list`, and their `gm.unknown_` twins.
