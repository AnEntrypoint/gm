---
name: gm-hop
description: "One traversal hop: a principle or book name and a surface path in, one receipt naming the next principle out. Owns the hop rules; pool rules are defined in gm-orchestrate. Invoke only from gm; do not load directly."
---

# gm-hop

Args: one JSON object `{"node":{"id":"<id>","label":"<Author - Title>","advocate":"<advocate spec>","links":[{"to":"<id>","guards":["<guard>"]}]},"surface":"<path>","session":"<SESSION_ID>","wave":"<wave>","depth":<n>,"rhetoric":""}`. `links` is sorted lexically by `to`. The payload is the only graph data a hop receives: it never loads `gm-graph.json`, and its links carry no direction, position or edge kind. `rhetoric`, `max_depth` (default 6, the wave's cap) and `wave` (names the ledger `.gm/pool/ledger-<wave>.txt`) are optional, except `wave` is required for ledger lines. A missing `node`, `surface` or `session`: `VERDICT: NOT-APPLICABLE`, no writes.

Verbs: gm Section 1. Code questions: callers and impact, then `codesearch` literal rooted at the surface. `Read` only located paths.

## Procedure
This hop is one node traversal. Its ledger `launch` and `done` lines are written by the orchestrator (gm-orchestrate, Tick).
0. Run the discipline named by `node.label` (e.g. `Meyer - Design by Contract`), against the surface, using `node.advocate` as its spec. Each entry of `node.links` is `{to, guards}`: a link is eligible when every guard holds on the surface, and only then is its `to` nominable. Nominate the next node only after the discipline has run. Never rename node ids.
1. Argue `rhetoric`'s open question in one paragraph, or the principle's weakest claim if empty.
2. List its testable claims: one checkable sentence each, with its test.
3. `codesearch` every instance a claim governs on the surface. Print cited lines. Drop absent text.
3a. When the surface asserts a cause, a defect or a fix, run the ACH principle (`gm-config/prose/ach.md`) before step 4: list at least two rival hypotheses, build the `C`/`I`/`N` matrix from dispatch-backed evidence, rank by fewest `I` cells, and name one probe that separates the leader from the next. Step 4 may act only on the leader. A rejected hypothesis gets no edit.
4. Close what one exact-match Edit closes, if no other writer holds the file (`git_status` with paths). Witness it live and keep the dispatch id. Revert a change that has no live witness.
5. `prd-add` each other finding as `<principle>-<SESSION_ID>-<n>`, using the full SESSION_ID, never a suffix of it. `prd-list` the id first. `prd-add` refuses an existing id unless the body carries `overwrite:true`, so a refused id takes the next `<n>`. Never send `overwrite` for another session's row. Retire or merge one stale row per row added.
6. Name the biggest need in one sentence.
7. Nominate the next node: an eligible link from step 0 whose `to` attacks the need. Every eligible link is nominable, whatever its position or history. At `depth` at or above `max_depth` (default 6), answer `next: none, depth limit`. Otherwise the receipt's `next:` names the link's `to` and `depth+1`, and `rhetoric` = your `next_choice.why` verbatim (three sentences max). The orchestrator builds the child's payload from the private graph, writes `launch <child-session> surface=<surface> row=-` to `.gm/pool/ledger-<wave>.txt`, and spawns the child. A hop never reads the private graph to build a payload. Your receipt's last act appends `done <session>` to the same ledger, on every verdict.

No witnessed change or verified row: `next: none`, with the reason.

## Node emission (the walk expands the tree)

A hop consumes a surface and EMITS a node. Emission is not optional and not a summary of the receipt. Write a file with a fixed shape on EVERY verdict, including NOT-APPLICABLE.

Write `.gm/lean-walk/<NODE>.json` (one file per node id; overwrite the node's own file, never another's) as:

```
{node, applied, changes, witness, prd_ids, mutable_ids, next_choice:{to,why},
 links_offered:[<to>, ...], link_taken:<to|null>, session, witness_dispatch_ids:[<dispatch id>, ...]}
```

- `links_offered` is the `to` of every entry of the payload's `node.links`, verbatim. `link_taken` is the `to` you nominate in `next:`, or `null` at `next: none`. `link_taken` is either null or a member of `links_offered`, never a third value.
- `applied:true` only when at least one change landed AND `witness` names a dispatch you hold. `witness_dispatch_ids` lists every dispatch id the witness quotes. `skills/dream-rsi/SKILL.md` Part B step 4 rejects the whole record when one of them is absent from `.gm/dream-rsi/<session>/observations.json`.
- Stamp `lean_node:"<NODE>"` on your dispatches. `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs` reads that body field, and `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs` records it on every observation.
- A discipline the surface demands that is not among `links_offered` is emitted, not dropped. Append one JSON line to `.gm/lean-walk/new-nodes.jsonl`: `{id,label,book,author,kind:"principle",proposed_by:<node.id>,session,witness}`. `id` is the upper-case slug of the book title. Refuse an `id` that already exists in `nodes[]`; join that node instead of duplicating it. A hop never edits `skills/dream-rsi/gm-graph.json`. The graph's owner promotes an emitted node into it.

`.gm/lean-walk/` is gitignored runtime state, so emission costs no commit and no push.

## Rules
- A receipt is the hop's own. When a hop spawns a successor, its receipt names the child session in `next:` and carries no text from the child. The orchestrator reads each receipt by the session it launched.
- A row for a principle already filed in this walk by another wave is merged by the orchestrator, not added again. A hop still lists and cites what it filed.
- A hop is one named principle from the book "lean" (AnEntrypoint/lean), applied as work to every instance in scope in one pass.
- A hop lists the real pending rows for its surface, records a one-line action per row, nominates its successor from that same list, and never invents an id.
- Every hop runs as its own subagent with its own SESSION_ID. The orchestrator never performs hop work inline. It dispatches the hop and reads its receipt.
- Motivation travels: `next_choice.why` goes verbatim to the next hop as `rhetoric`.
- Choose the next node by project fit and diversity.
- Back-verify: traversal is unfinished until earlier applied nodes that a later change may affect are re-checked.
- Each confirmed node-only row is `prd-add`ed at once, never batched to the end of the hop. A hop with zero rows logged 15 minutes after its heartbeat start stops and returns a receipt: surfaces scanned, candidates checked, rows logged (0), reason.
- A NOT-APPLICABLE receipt never deletes `.gm/pool/<session>.next`. Only the orchestrator deletes a parked spec, after its relaunch is accepted.
- A hop creates PRDs; it never executes its own. Merge duplicate outcome rows (`outcome-hop-*`, `cpu-hop-outcome-*`) into the base row. Never add them.
- The receipt names an executed witness (a command, a crawl result, a codesearch output). A receipt without one is refused.
- Instructions to agents: ultra-compact, meaning intact. A hop is one lane, never the pool. The four dip causes that hold live at the ceiling, and their counter-instructions, are defined in `skills/gm-orchestrate/SKILL.md` (Never let the pool dip).
- **Context budget: a hop that dies with "Prompt is too long" is relaunched compact, never resumed.** The relaunch re-sends principle, surface, depth, `visited` and a three-sentence `rhetoric`, and nothing else. Never send the dead hop's transcript or a file body. A spawn passes located `path:line` citations; the child re-reads what it needs.
- **A hop never dispatches `Skill(skill="gm-continue")`.** That call is the parent orchestrator's terminal move. A hop ends on its receipt, plus the parked line when it names a successor.
- **A hop commits; it does not push and does not pull.** Commit with explicit `paths` and end the hop. The publish is one dispatch per wave by the orchestrator (gm-orchestrate, The publish). Publish the tip with `git_push {rev:"<full sha of the tip>", allow_foreign_commits:true}`; `rev:"HEAD"` is refused. A hop that finds its own commit unpushed records the sha in its receipt and does not retry the push. Pulls are the orchestrator's move. A hop reads remote state with `branch_status`.
- **Starved git verb: one re-dispatch, then a row.** The re-dispatch rule is defined in gm-orchestrate (Observation and git-lane starvation). A hop that is starved a second time files a PRD row naming the commit sha and stops. A remote-moved refusal (`gate_denied`) is the orchestrator's move too, never a hop's: its recovery is `git_pull {branch}` then `git_push {rev:"<full sha of the tip>", allow_foreign_commits:true}`.
- **A hop issues at most two git verbs: one `git_status {paths}`, one `git_commit {paths}`.** Read state from the responses you already hold. Use `branch_status` only when the hop needs remote state, once.
- **Commit author and trailers.** The rule "One commit author, no trailers" is defined in gm (Autonomy). A hop follows it.
- **Re-bake in the same commit as the source edit that moved the code.** Before `git_commit`, `codesearch` `BAKE_INPUTS_` (and `HEIGHTFIELD_BAKE`, `MINIMAP_BAKE`, `GLB_TRANSFORM`, `KTX2_EXTRACT`, `PROGRESSIVE_BAKE`, `SNAPSHOT_ENCODE`, `COLLISION_GRID`) for the declared bake-input closures. If a touched path sits in one, re-run that closure's generator, put every artifact it produces in the SAME path-scoped commit as the source edit, and require the cache-key check to exit 0 before committing. An artifact re-baked in a later commit is another red push.
- **A successor spawn refused by the concurrent-subagent ceiling is parked, not dropped.** Write the successor spec to `.gm/pool/<session>.next` (principle, surface, depth, `visited`, `rhetoric`, witness id). End the receipt with `HOP next-principle <NAME> <surface> (spawn blocked: ceiling; parked at .gm/pool/<session>.next)`. The orchestrator relaunches the parked file into the first freed slot. Never re-spawn in a loop against the refusal.
- **A `prd-add` refusal names one row file: `.gm/prd/<id>.yml`. Fix that file, never a shared store.** A write is a compare-and-swap of that one file. Retry once, since the retry re-reads. If it still refuses, repair or remove that one file and re-add the row.

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
