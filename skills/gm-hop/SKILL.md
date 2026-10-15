---
name: gm-hop
description: "Use when a gm walk must apply one named principle (book or discipline) to a code surface and move on to the next principle: it applies the principle to every in-scope instance in one pass and returns one receipt naming the next principle, so the traversal advances with witnessed changes or filed PRD rows. Owns the hop rules; pool rules are defined in gm-orchestrate. Invoke only from gm; do not load directly."
---

# gm-hop

Args: one JSON object `{"node":{"id":"<id>","label":"<Author - Title>","advocate":"<advocate spec>","links":[{"to":"<id>","guards":["<guard>"]}]},"surface":"<path>","session":"<SESSION_ID>","wave":"<wave>","depth":<n>,"rhetoric":""}`. `links` sorted lexically by `to`. The payload is the only graph data a hop receives: never load `gm-graph.json`; links carry no direction, position or edge kind. `rhetoric`, `max_depth` (default 6, the wave's cap) and `wave` (names `.gm/pool/ledger-<wave>.txt`) are optional; `wave` is required for ledger lines. Missing `node`, `surface` or `session`: `VERDICT: NOT-APPLICABLE`, no writes.

Verbs: gm Section 1. Code questions: callers and impact, then `codesearch` literal rooted at the surface. `Read` only located paths.

## Procedure
Ledger `launch` and `done` lines are written by the orchestrator (gm-orchestrate, Tick).
0. Run the discipline named by `node.label` (e.g. `Meyer - Design by Contract`) against the surface, using `node.advocate` as spec. A link in `node.links` is eligible when every guard holds on the surface; only then is its `to` nominable. Nominate only after the discipline has run. Never rename node ids.
1. Argue `rhetoric`'s open question in one paragraph, or the principle's weakest claim if empty.
2. List testable claims: one checkable sentence each, with its test.
3. `codesearch` every instance a claim governs on the surface. Print cited lines. Drop absent text.
3a. If the surface asserts a cause, defect or fix, run ACH (`gm-config/prose/ach.md`) before step 4: at least two rival hypotheses; a `C`/`I`/`N` matrix from dispatch-backed evidence; rank by fewest `I` cells; one probe separating the leader from the next. Step 4 acts only on the leader. A rejected hypothesis gets no edit.
4. Close what one exact-match Edit closes, if no other writer holds the file (`git_status` with paths). Witness it live and keep the dispatch id. Revert any change without a live witness.
5. `prd-add` each other finding as `<principle>-<SESSION_ID>-<n>` using the full SESSION_ID, never a suffix. `prd-list` the id first. `prd-add` refuses an existing id unless `overwrite:true`, so a refused id takes the next `<n>`. Never send `overwrite` for another session's row. Retire or merge one stale row per row added.
6. Name the biggest need in one sentence.
7. Nominate the next node: an eligible link from step 0 whose `to` attacks the need. Every eligible link is nominable regardless of position or history. At `depth` ≥ `max_depth` (default 6): `next: none, depth limit`. Otherwise `next:` names the link's `to` and `depth+1`; `rhetoric` = your `next_choice.why` verbatim (three sentences max). The orchestrator builds the child payload from the private graph, writes `launch <child-session> surface=<surface> row=-` to `.gm/pool/ledger-<wave>.txt`, and spawns the child. A hop never reads the private graph to build a payload. The receipt's last act appends `done <session>` to the same ledger, on every verdict.

No witnessed change or verified row: `next: none`, with the reason.

## Node emission
A hop consumes a surface and EMITS a node. Emission is not optional and not a summary of the receipt. Write a file of fixed shape on EVERY verdict, including NOT-APPLICABLE.

Write `.gm/lean-walk/<NODE>.json` (overwrite only the node's own file):
```
{node, applied, changes, witness, prd_ids, mutable_ids, next_choice:{to,why},
 links_offered:[<to>, ...], link_taken:<to|null>, session, witness_dispatch_ids:[<dispatch id>, ...]}
```
- `links_offered` = the `to` of every entry of the payload's `node.links`, verbatim. `link_taken` = the `to` you nominate in `next:`, or `null` at `next: none`; never a third value.
- `applied:true` only when ≥1 change landed AND `witness` names a dispatch you hold. `witness_dispatch_ids` lists every dispatch id the witness quotes. `skills/dream-rsi/SKILL.md` Part B step 4 rejects the whole record when one is absent from `.gm/dream-rsi/<session>/observations.json`.
- Stamp `lean_node:"<NODE>"` on your dispatches (read by `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs`; recorded per observation in `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`).
- A discipline the surface demands that is not in `links_offered` is emitted, not dropped: append one JSON line to `.gm/lean-walk/new-nodes.jsonl`: `{id,label,book,author,kind:"principle",proposed_by:<node.id>,session,witness}`. `id` = upper-case slug of the book title. Refuse an `id` already in `nodes[]`; join that node instead. Never edit `skills/dream-rsi/gm-graph.json`; its owner promotes emitted nodes.
- `.gm/lean-walk/` is gitignored runtime state: no commit, no push.
- Evidence budget: the node file keeps verdict fields and pointers only. A bulky array (per-line rewrites, per-file match lists) moves to `.gm/lean-walk/<NODE>-<field>.json`, named by path in the node file. Node file stays under 4 KB.

## Rules
- A receipt is the hop's own. A hop that spawns a successor names the child session in `next:` and carries no child text. The orchestrator reads each receipt by the session it launched.
- A principle already filed in this walk by another wave is merged by the orchestrator, never added again; the hop still lists and cites what it filed.
- A hop is one named principle from the book "lean" (AnEntrypoint/lean), applied as work to every in-scope instance in one pass.
- A hop lists the real pending rows for its surface, records a one-line action per row, nominates its successor from that list, never invents an id.
- Every hop runs as its own subagent with its own SESSION_ID. The orchestrator never performs hop work inline; it dispatches and reads the receipt.
- `next_choice.why` goes verbatim to the next hop as `rhetoric`.
- Choose the next node by project fit and diversity.
- Back-verify: traversal is unfinished until earlier applied nodes a later change may affect are re-checked.
- Each confirmed node-only row is `prd-add`ed at once, never batched to the end. A hop with zero rows 15 minutes after its heartbeat start stops and returns a receipt: surfaces scanned, candidates checked, rows logged (0), reason.
- A NOT-APPLICABLE receipt never deletes `.gm/pool/<session>.next`; only the orchestrator deletes a parked spec, after its relaunch is accepted.
- A hop creates PRDs; it never executes its own. Merge duplicate outcome rows (`outcome-hop-*`, `cpu-hop-outcome-*`) into the base row; never add them.
- The receipt names an executed witness (a command, crawl result, codesearch output). A receipt without one is refused.
- Instructions to agents: ultra-compact, meaning intact. A hop is one lane, never the pool. The four dip causes and counter-instructions: `skills/gm-orchestrate/SKILL.md` (Never let the pool dip).
- Context budget: a hop dying with "Prompt is too long" is relaunched compact, never resumed. The relaunch re-sends principle, surface, depth, `visited` and a three-sentence `rhetoric`, nothing else. Never send the dead hop's transcript or a file body; a spawn passes located `path:line` citations.
- A hop never dispatches `Skill(skill="gm-continue")`. That is the parent orchestrator's terminal move. A hop ends on its receipt, plus the parked line when it names a successor.
- A hop commits; it does not push and does not pull. Commit with explicit `paths` and end. The publish is one dispatch per wave by the orchestrator (gm-orchestrate, Shared-tree publish): `git_push {rev:"<full sha of the tip>", allow_foreign_commits:true}`; `rev:"HEAD"` is refused. A hop finding its commit unpushed records the sha in its receipt and does not retry the push. Remote state: `branch_status`.
- Starved git verb: one re-dispatch (gm-orchestrate, Starvation); a second starvation files a PRD row naming the commit sha and stops. A remote-moved refusal (`gate_denied`) is the orchestrator's move: `git_pull {branch}` then `git_push {rev:"<full sha of the tip>", allow_foreign_commits:true}`.
- A hop issues at most two git verbs: one `git_status {paths}`, one `git_commit {paths}`. Read state from responses already held. `branch_status` only when remote state is needed, once.
- Commit author and trailers: gm, One commit author, no trailers.
- Re-bake in the same commit as the source edit that moved the code. Before `git_commit`, `codesearch` `BAKE_INPUTS_` (and `HEIGHTFIELD_BAKE`, `MINIMAP_BAKE`, `GLB_TRANSFORM`, `KTX2_EXTRACT`, `PROGRESSIVE_BAKE`, `SNAPSHOT_ENCODE`, `COLLISION_GRID`) for declared bake-input closures. If a touched path is in one, re-run that closure's generator, put every artifact it produces in the SAME path-scoped commit, and require the cache-key check to exit 0 before committing. An artifact re-baked later is another red push.
- A successor spawn refused by the concurrent-subagent ceiling is parked, not dropped: write `.gm/pool/<session>.next` (principle, surface, depth, `visited`, `rhetoric`, witness id); end with `HOP next-principle <NAME> <surface> (spawn blocked: ceiling; parked at .gm/pool/<session>.next)`. The orchestrator relaunches it into the first freed slot. Never re-spawn in a loop against the refusal.
- A `prd-add` refusal names one row file, `.gm/prd/<id>.yml`: fix that file, never a shared store. Writes are compare-and-swap of that one file. Retry once; if still refused, repair or remove that file and re-add the row.

Receipt (120 words max):
```
VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
PRINCIPLE: <id>; SURFACE: <path>; WITNESS: <audit dispatch id>
CHANGED: <file, dispatch id> | none
ACH: <n> hypotheses; leader <id>; rejected <ids>; probe <dispatch id>; flips-on <evidence> | none, no cause asserted
ROWS: <n>: <ids>
EMITTED: .gm/lean-walk/<NODE>.json [+1 new node]
NEED: <one sentence>
next: <id>; depth=<n+1> | none, <reason>
```
