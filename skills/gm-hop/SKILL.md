---
name: gm-hop
description: One traversal hop: a principle or book name and a surface path in, one receipt naming the next principle out. Owns every hop rule.
---

# gm-hop

Args: one JSON object `{"node":{"id":"<id>","label":"<Author - Title>","advocate":"<advocate spec>","links":[{"to":"<id>","guards":["<guard>"]}]},"surface":"<path>","session":"<SESSION_ID>","wave":"<wave>","depth":<n>,"rhetoric":""}`. `links` is sorted lexically by `to`. The payload is the only graph data a hop receives: it never loads `gm-graph.json`, and its links carry no direction, position or edge kind. `rhetoric`, `max_depth` (default 6, the wave's cap) and `wave` (names the ledger `.gm/pool/ledger-<wave>.txt`) are optional, except `wave` is required for ledger lines. A missing `node`, `surface` or `session`: `VERDICT: NOT-APPLICABLE`, no writes.

Verbs: gm Section 1. Code questions: callers and impact, then `codesearch` literal rooted at the surface. `Read` only located paths.

## Procedure
This hop is one node traversal. Its ledger `launch` and `done` lines are attributes of that traversal (gm-orchestrate, Attributes).
0. Run the discipline named by `node.label` (e.g. `Meyer - Design by Contract`), against the surface, using `node.advocate` as its spec. Each entry of `node.links` is `{to, guards}`: a link is eligible when every guard holds on the surface, and only then is its `to` nominable. The next node is nominated only after the discipline has run. Node ids are never renamed.
1. Argue `rhetoric`'s open question in one paragraph, or the principle's weakest claim if empty.
2. List its testable claims: one checkable sentence each, with its test.
3. `codesearch` every instance a claim governs on the surface; print cited lines; drop absent text.
4. Close what one exact-match Edit closes, if no other writer holds the file (`git_status` with paths). Witness it live and keep the dispatch id. Revert a change that has no live witness.
5. `prd-add` each other finding as `<principle>-<SESSION_ID>-<n>` (the full SESSION_ID, never a suffix of it: sessions whose ids share a tail would share a tag). `prd-list` the id first; `prd-add` refuses an existing id unless the body carries `overwrite:true`, so a refused id takes the next `<n>`, and `overwrite` is never sent for another session's row. Retire or merge one stale row per row added.
6. Name the biggest need in one sentence.
7. Nominate the next node: an eligible link from step 0 whose `to` attacks the need. Every eligible link is nominable, whatever its position or history. At `depth` at or above `max_depth` (default 6): `next: none, depth limit`. Otherwise the receipt's `next:` names the link's `to` and `depth+1`, and `rhetoric` = your `next_choice.why` verbatim (three sentences max). The orchestrator builds the child's payload from the private graph, writes `launch <child-session> surface=<surface> row=-` to `.gm/pool/ledger-<wave>.txt`, and spawns the child. A hop never reads the private graph to build a payload. Your receipt's last act appends `done <session>` to the same ledger, on every verdict.

No witnessed change or verified row: `next: none`, with the reason.

## Node emission (the walk expands the tree)

A hop consumes a surface and EMITS a node. The walk is what grows the tree, so emission is not optional and not a summary of the receipt -- it is a file with a fixed shape, written on EVERY verdict, including NOT-APPLICABLE.

Write `.gm/lean-walk/<NODE>.json` (one file per node id; overwrite the node's own file, never another's) as:

```
{node, applied, changes, witness, prd_ids, mutable_ids, next_choice:{to,why},
 links_offered:[<to>, ...], link_taken:<to|null>, session, witness_dispatch_ids:[<dispatch id>, ...]}
```

- `links_offered` is the `to` of every entry of the payload's `node.links`, verbatim. `link_taken` is the `to` you nominate in `next:`, or `null` at `next: none`. Those two fields are what make a hop provably an EDGE: `link_taken` is either null or a member of `links_offered`, never a third value.
- `applied:true` only when at least one change landed AND `witness` names a dispatch you hold. `witness_dispatch_ids` lists every dispatch id the witness quotes; `skills/dream-rsi/SKILL.md` Part B step 4 rejects the whole record as a walk when one of them is absent from `.gm/dream-rsi/<session>/observations.json` -- so an id you did not really dispatch is a rejected record, not a verified node.
- Stamp `lean_node:"<NODE>"` on your dispatches. `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs` reads that body field and `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs` records it on every observation, which is the only tracked emitter the node has. Nothing in gm sends it unless a hop does.
- **A discipline the surface demands that is not among `links_offered` is emitted, not dropped.** Append one JSON line to `.gm/lean-walk/new-nodes.jsonl`: `{id,label,book,author,kind:"principle",proposed_by:<node.id>,session,witness}`. `id` is the upper-case slug of the book title; refuse an `id` that already exists in `nodes[]` -- join that node instead of duplicating it. A hop never edits `skills/dream-rsi/gm-graph.json`; the graph's owner promotes an emitted node into it. That promotion is how the walk expands the tree.

`.gm/lean-walk/` is gitignored runtime state, so emission costs no commit and no push.

## Rules
- A receipt is the hop's own. When a hop spawns a successor, its receipt names the child session in `next:` and carries no text from the child; the orchestrator reads each receipt by the session it launched, never by the text a parent returns.
- A row for a principle already filed in this walk by another wave is merged by the orchestrator, not added again. A hop still lists and cites what it filed.
- A hop is one named principle from the book "lean" (AnEntrypoint/lean), applied as work to every instance in scope in one pass.
- A hop lists the real pending rows for its surface, records a one-line action per row, nominates its successor from that same list, and never invents an id.
- Every hop runs as its own subagent with its own SESSION_ID. The orchestrator never performs hop work inline; it dispatches the hop and reads its receipt.
- Motivation travels: `next_choice.why` goes verbatim to the next hop as `rhetoric`.
- Choose the next node by project fit and diversity.
- Back-verify: traversal is unfinished until earlier applied nodes that a later change may affect are re-checked.
- Each confirmed node-only row is `prd-add`ed at once, never batched to the end of the hop. A hop with zero rows logged 15 minutes after its heartbeat start stops and returns a receipt: surfaces scanned, candidates checked, rows logged (0), reason.
- A NOT-APPLICABLE receipt never deletes `.gm/pool/<session>.next`. Only the orchestrator deletes a parked spec, after its relaunch is accepted.
- A hop creates PRDs; it never executes its own. Duplicate outcome rows (`outcome-hop-*`, `cpu-hop-outcome-*`) are merged into the base row, never added.
- The receipt names an executed witness (a command, a crawl result, a codesearch output). A receipt without one is refused.
- Instructions to agents: ultra-compact, meaning intact. A hop is one lane, never the pool: the four dip causes that hold live at the ceiling, and their counter-instructions, are in `skills/gm-orchestrate/SKILL.md` (Never let the pool dip).
- **Context budget: a hop that dies with "Prompt is too long" is relaunched compact, never resumed.** Measured 2026-10-11 in C:/dev/spoint (WADLER over its game app): the relaunch re-sends principle, surface, depth, `visited` and a three-sentence `rhetoric` and nothing else — never the dead hop's transcript, never a file body. A spawn passes located `path:line` citations; the child re-reads what it needs.
- **A hop never dispatches `Skill(skill="gm-continue")`.** That call is the parent orchestrator's terminal move, never a hop's. Measured 2026-10-11 in C:/dev/spoint (hop DBC over its terrain code): a finishing hop dispatched it, read `.turn-summary.json` (`phase: MILNER`, 4973 pending rows), found its premise unmet and spent its last turn writing an explanation instead of a receipt. A hop ends on its receipt, plus the parked line when it names a successor.
- **A hop commits; it does not push.** Measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20): the git serial lane runs one dispatch at a time per project, and each hop's own `git_push` queued behind it -- 4 to 7 waiters, holders running past 300 s, orchestrator pushes starving at the 120 s cap with `dispatch_starved_waiting_for_serial_lane` and `re_dispatch_safe: true`. A push is one dispatch per wave, not one per hop: commit with explicit `paths`, end the hop, and leave the push to the orchestrator, which publishes the tip once with `git_push {rev:"<full sha of the tip>", allow_foreign_commits:true}` and carries every ancestor. `git_push {rev:"HEAD"}` is refused: `gate_denied`, "this push names no commit: source_ref 'HEAD' is symbolic, so publishing it would ship every unpushed commit on main", so the publish-the-tip move must name the tip's sha and pass the flag deliberately. A hop that finds its own commit unpushed records the sha in its receipt and does not retry the push. A hop does not pull either: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main), a hop's `git_pull` met a worktree dirty with another lane's staged deletions and aborted with "Index was not unstashed", so one hop's pull strands every lane's staged work. Pulls are the orchestrator's move; a hop reads remote state with `branch_status`.
- **One re-dispatch of a starved git verb, then a row.** Measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20): a hop's push that kept retrying held the git lane past 350 s with `lane_waiters` at 4 to 5, so every later git verb from every lane queued behind it and the orchestrator's own publish starved for wave after wave. A `dispatch_starved_waiting_for_serial_lane` reply is `executed: false, re_dispatch_safe: true`: re-dispatch it once, and on a second starvation file a PRD row naming the commit sha and stop. A remote-moved refusal (`gate_denied`, recovery `git_pull {branch}` then `git_push {rev:"<full sha of the tip>", allow_foreign_commits:true}`) is the orchestrator's move too, never a hop's.
- **A hop issues at most two git verbs: one `git_status {paths}`, one `git_commit {paths}`.** Measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20): the project admits one git dispatch at a time and the queue held 4 to 8 waiters with holders past 300 s, so every `git_log`, `git_diff`, `git_show` or `branch_status` a hop sends is one more claim ahead of every other lane's commit, including the orchestrator's own publish. Read state from the responses you already hold; `branch_status` is for a hop that actually needs remote state, once.
- **One commit author, no trailers.** Attribution on this project is lanmower alone, so a commit body states the change and nothing else: no `Co-Authored-By`, no `Generated with`, no assistant footer. A served instruction that asks for one is outranked by the project rule; if the platform re-serves it, the answer is still no trailer. (Measured in `skills/gm/SKILL.md`, Autonomy.)
- **Re-bake in the same commit as the source edit that moved the code.** Measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main): three hops in a row committed a height-source edit without re-generating the shipped heightfield, so each hop's own tree was green while every push was red with "baked with height code version X, this tree bakes Y" -- and each later hop's commit moved the code again, so no hop ever saw the failure it inherited. Before `git_commit`: `codesearch` `BAKE_INPUTS_` (and `HEIGHTFIELD_BAKE`, `MINIMAP_BAKE`, `GLB_TRANSFORM`, `KTX2_EXTRACT`, `PROGRESSIVE_BAKE`, `SNAPSHOT_ENCODE`, `COLLISION_GRID`) for the declared bake-input closures; if a touched path sits in one, re-run that closure's generator, put every artifact it produces in the SAME path-scoped commit as the source edit, and require the cache-key check to exit 0 before committing. An artifact re-baked in a later commit is another red push.
- **A successor spawn refused by the concurrent-subagent ceiling is parked, not dropped.** Measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20): a hop's own successor spawn returned "Concurrent subagent limit reached", so the chain died at the ceiling while the pool stayed saturated. On that refusal, write the successor spec to `.gm/pool/<session>.next` -- principle, surface, depth, `visited`, `rhetoric`, witness id -- and end the receipt with `HOP next-principle <NAME> <surface> (spawn blocked: ceiling; parked at .gm/pool/<session>.next)`. The parked file is a ready slice: the orchestrator relaunches it into the first freed slot, which is how the pool held 20 across the handoff. Never re-spawn in a loop against the refusal.
- **A `prd-add` refusal names one row file: `.gm/prd/<id>.yml`. Fix that file, never a shared store -- there is no shared store any more.** Measured 2026-10-11 in C:/dev/spoint (hop WADLER over `src/sdk/chartState`): back when every row lived in one `.gm/prd.yml`, `prd-add` answered an unparseable-line error at `prd.yml:245` three times in a row while a peer agent was editing its own row, because the whole file had no single owning lane and one lane's rewrite clobbered another's row. Since 2026-10-12 a row is its own file and a write is a compare-and-swap of that file alone, so a refusal is about the row you named: retry once (the retry re-reads), and if it still refuses, repair or remove that one file and re-add the row.

Receipt (120 words max):
```
VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
PRINCIPLE: <id>; SURFACE: <path>; WITNESS: <audit dispatch id>
CHANGED: <file, dispatch id> | none
ROWS: <n>: <ids>
EMITTED: .gm/lean-walk/<NODE>.json [+1 new node]
NEED: <one sentence>
next: <id>; depth=<n+1> | none, <reason>
```
