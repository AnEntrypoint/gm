---
name: gm-hop
description: "Use when a gm walk must apply one named principle (book or discipline) to a code surface and move on to the next principle: it applies the principle to every in-scope instance in one pass and returns one receipt naming the next principle, so the traversal advances with witnessed changes or filed PRD rows. Owns the hop rules; pool rules are defined in gm-orchestrate. Invoke only from gm; do not load directly."
---

# gm-hop

Args: one JSON object `{"node":{"id":"<id>","label":"<Author - Title>","advocate":"<advocate spec>","links":[{"to":"<id>","guards":["<guard>"]}]},"surface":"<path>","session":"<SESSION_ID>","wave":"<wave>","depth":<n>,"rhetoric":""}`. `links` sorted lexically by `to`. The payload is the only graph data a hop receives: never load `gm-graph.json`; links carry no direction, position or edge kind. `rhetoric`, `max_depth` (default 6, the wave's cap) and `wave` (names `.gm/pool/ledger-<wave>.txt`) are optional; `wave` is required for ledger lines. Missing `node`, `surface` or `session`: `VERDICT: NOT-APPLICABLE`, no writes.

Verbs: gm §1. Code questions: gm, Autonomy (codeinsight first, then `codesearch` literal rooted at the surface). `Read` only located paths.

## Procedure
Ledger `launch` and `done` lines are written by the orchestrator (gm-orchestrate, Tick), except the hop's own final `done` (step 7).
0. Run the discipline named by `node.label` (e.g. `Meyer - Design by Contract`) against the surface, using `node.advocate` as spec. A link in `node.links` is eligible when every guard holds on the surface; only then is its `to` nominable. Nominate only after the discipline has run. Never rename node ids.
1. Argue `rhetoric`'s open question in one paragraph, or the principle's weakest claim if empty.
2. List testable claims: one checkable sentence each, with its test.
3. `codesearch` every instance a claim governs on the surface. Print cited lines. Drop absent text.
3a. If the surface asserts a cause, defect or fix, run ACH (`gm-config/prose/ach.md`) before step 4: at least two rival hypotheses; a `C`/`I`/`N` matrix from dispatch-backed evidence; rank by fewest `I` cells; one probe separating the leader from the next. Step 4 acts only on the leader. A rejected hypothesis gets no edit.
4. Close what one exact-match Edit closes, if no other writer holds the file (`git_status` with paths). Witness it live and keep the dispatch id. Revert any change without a live witness.
5. Before each `prd-add`, one `codesearch` over `.gm/prd/` for the finding's cause literal (verb name or file path); on a hit, append the witness to that row when this hop owns it, else cite its id in the receipt, and add nothing. Otherwise `prd-add` the finding as `<principle>-<SESSION_ID>-<n>` using the full SESSION_ID, never a suffix. `prd-add` refuses an existing id unless `overwrite:true`, so a refused id takes the next `<n>`. Never send `overwrite` for another session's row. Retire or merge one stale row per row added. A discipline whose output is order, rank or choice (PERT, MoSCoW, Pugh, Wardley) files no row of its own: it writes that ordering as `blockedBy` edges or a merged `acceptance_criteria` on the target rows it names, and it never files a plan as a pending row.
6. Name the biggest need in one sentence.
7. Nominate the next node: an eligible link from step 0 whose `to` attacks the need. Every eligible link is nominable regardless of position or history. At `depth` ≥ `max_depth` (default 6): `next: none, depth limit`. Otherwise `next:` names the link's `to` and `depth+1`; `rhetoric` = your `next_choice.why` verbatim (three sentences max). The orchestrator builds the child payload from the private graph, appends `launch <child-session> surface=<surface> row=-` to `.gm/pool/ledger-<wave>.txt`, and spawns the child. The receipt's last act appends `done <session>` to the same ledger, on every verdict, as `fs_write {"path":"<path>","content":"done <session>\n","append":true,"run_end":true}`; the `run_end` stamp is the end-of-run marker that `agentplug/crates/agentplug-runner/src/dream_cycle.rs` reads (`ended`). Every ledger and `new-nodes.jsonl` line is an append: `fs_write {"path":"<path>","content":"<line>\n","append":true}`; a whole-file write to these shared logs is refused.

8. Close the hop's own Dream-RSI cycle before the receipt: dispatch `dream-replay-cycle` with `{"session_id":"<session>"}`, retrying once if refused, and record its dispatch id and status (`replayed`, or `deferred` with the refusal's cause) in the receipt's `CYCLE:` line.

No witnessed change or verified row: `next: none`, with the reason.

## Node emission
A hop consumes a surface and EMITS a node. Emission is not optional and not a summary of the receipt. Write a file of fixed shape on EVERY verdict, including NOT-APPLICABLE.

Write `.gm/lean-walk/<NODE>.<SESSION>.json` (keyed by node and owner session, so parallel visits of one node never overwrite each other; overwrite only this session's file):
```
{node, applied, changes, witness, prd_ids, unknown_ids, next_choice:{to,why},
 links_offered:[<to>, ...], link_taken:<to|null>, session, witness_dispatch_ids:[<dispatch id>, ...],
 verified_by:<session>|null, verified_dispatch_ids:[<dispatch id>, ...],
 findings:[{prd_id, owner, disposition:accept|merge|reject}], inspector:<session>|null}
```
- `findings` lists every PRD row this hop filed or cited, one entry each: `owner` = the session that holds the row, `disposition` = the moderator's verdict (`accept` until the orchestrator writes otherwise). `inspector` names the session that ran the judge check, or `null` when no judge ran.
- `links_offered` = the `to` of every entry of the payload's `node.links`, verbatim. `link_taken` = the `to` you nominate in `next:`, or `null` at `next: none`; never a third value.
- `applied:true` only when ≥1 change landed AND `witness` names a dispatch you hold. `witness_dispatch_ids` lists every dispatch id the witness quotes. `skills/dream-rsi/SKILL.md` Part B step 4 rejects the whole record when one is absent from `.gm/dream-rsi/<session>/observations.json`.
- Independent verification: the hop never witnesses its own edit. Before setting `applied:true`, spawn a verifier subagent with session `<session>-v1` that receives only the change contract (file, expected edit, witness command) and re-runs the witness live. The hop records `verified_by:"<session>-v1"` and the verifier's dispatch ids in `verified_dispatch_ids`. Without a verifier pass, write `applied:false` and `verified_by:null`. `skills/dream-rsi/SKILL.md` Part B step 2 counts a walk only when `verified_by` is a session other than the node's own `session`.
- Stamp `lean_node:"<NODE>"` on your dispatches (read by `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs`; recorded per observation in `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`).
- A discipline the surface demands that is not in `links_offered` is emitted, not dropped: append one JSON line (`fs_write` with `append:true`) to `.gm/lean-walk/new-nodes.jsonl`: `{id,label,book,author,kind:"principle",proposed_by:<node.id>,session,witness}`. `id` = upper-case slug of the book title. Refuse an `id` already in `nodes[]`; join that node instead. Never edit `skills/dream-rsi/gm-graph.json`; its owner promotes emitted nodes.
- `.gm/lean-walk/` is gitignored runtime state: no commit, no push.
- Evidence budget: the node file keeps verdict fields and pointers only. A bulky array (per-line rewrites, per-file match lists) moves to `.gm/lean-walk/<NODE>-<field>.json`, named by path in the node file. Node file stays under 4 KB. Two visits of one node by different sessions leave two files; neither overwrites the other.

## Rules
- A receipt is the hop's own. A hop that spawns a successor names the child session in `next:` and carries no child text. The orchestrator reads each receipt by the session it launched.
- A principle already filed in this walk by another wave is merged by the orchestrator, never added again; the hop still lists and cites what it filed.
- A hop is one named principle from the book "lean" (AnEntrypoint/lean), applied as work to every in-scope instance in one pass.
- A hop reads the pending rows once at start inside one `gm_codemode` body: `prd-list {"status":"pending","limit":<n>}` filtered in code to the ids and subjects matching its principle or cause literal, returned as that list only. It records a one-line action per row, nominates its successor from that list, never invents an id. Before each add it checks only that id (step 5).
- Every hop runs as its own subagent with its own SESSION_ID. The orchestrator never performs hop work inline; it dispatches and reads the receipt.
- Choose the next node by project fit and diversity.
- Back-verify: traversal is unfinished until earlier applied nodes a later change may affect are re-checked.
- Each confirmed node-only row is `prd-add`ed at once, never batched to the end. A hop with zero rows 15 minutes after its heartbeat start stops and returns a receipt: surfaces scanned, candidates checked, rows logged (0), reason.
- A NOT-APPLICABLE receipt never deletes `.gm/pool/<session>.next`; only the orchestrator deletes a parked spec, after its relaunch is accepted.
- A hop creates PRDs; it never executes its own. Merge duplicate outcome rows (`outcome-hop-*`, `cpu-hop-outcome-*`) into the base row; never add them.
- The receipt names an executed witness (a command, crawl result, codesearch output). A receipt without one is refused.
- Instructions to agents: ultra-compact, meaning intact. A hop is one lane, never the pool. Dip causes and counter-instructions: gm-orchestrate, Never let the pool dip.
- Context budget: a hop dying with `Prompt is too long` is relaunched compact, never resumed (gm-orchestrate, Never let the pool dip, cause 4). The relaunch re-sends principle, surface, depth, `visited` and a three-sentence `rhetoric`, nothing else. Never send the dead hop's transcript or a file body; a spawn passes located `path:line` citations.
- A hop never dispatches the `gm-continue` skill. That is the parent orchestrator's terminal move. A hop ends on its receipt, plus the parked line when it names a successor.
- A hop commits; it does not push and does not pull. Commit with explicit `paths` and end. The publish is one dispatch per wave by the orchestrator (gm-orchestrate, Shared-tree publish). A hop finding its commit unpushed records the sha in its receipt and does not retry the push. Remote state: `branch_status`. Commit author and trailers: gm, Autonomy.
- Starved git verb: one re-dispatch (gm-orchestrate, Starvation); a second starvation files a PRD row naming the commit sha and stops. A remote-moved refusal (`gate_denied`) is the orchestrator's move (gm-orchestrate, Shared-tree publish).
- A hop issues at most two git verbs: one `git_status {paths}`, one `git_commit {paths}`. Read state from responses already held. `branch_status` only when remote state is needed, once.
- Re-bake in the same commit as the source edit that moved the code. Before `git_commit`, `codesearch` `BAKE_INPUTS_` (and `HEIGHTFIELD_BAKE`, `MINIMAP_BAKE`, `GLB_TRANSFORM`, `KTX2_EXTRACT`, `PROGRESSIVE_BAKE`, `SNAPSHOT_ENCODE`, `COLLISION_GRID`) for declared bake-input closures. If a touched path is in one, re-run that closure's generator, put every artifact it produces in the SAME path-scoped commit, and require the cache-key check to exit 0 before committing. An artifact re-baked later is another red push.
- A successor spawn refused by the concurrent-subagent ceiling retries once when a slot frees. Refused again, it is parked, not dropped: write `.gm/pool/<session>.next` (principle, surface, depth, `visited`, `rhetoric`, witness id); end with `HOP next-principle <NAME> <surface> (spawn blocked: ceiling; parked at .gm/pool/<session>.next)`. The orchestrator relaunches it into the first freed slot. Never re-spawn in a loop against the refusal.
- A `prd-add` refusal names one row file, `.gm/prd/<id>.yml`: fix that file, never a shared store. Writes are compare-and-swap of that one file. Retry once; if still refused, repair or remove that file and re-add the row.

Receipt (120 words max):
```
VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
PRINCIPLE: <id>; SURFACE: <path>; WITNESS: <audit dispatch id>
CHANGED: <file, dispatch id> | none
ACH: <n> hypotheses; leader <id>; rejected <ids>; probe <dispatch id>; flips-on <evidence> | none, no cause asserted
ROWS: <n>: <ids>; FINDINGS: <prd_id>=<owner>/<disposition>, inspector <session>|none
EMITTED: .gm/lean-walk/<NODE>.<SESSION>.json [+1 new node]
CYCLE: <dream-replay-cycle dispatch id>; status <replayed|deferred, reason>
NEED: <one sentence>
next: <id>; depth=<n+1> | none, <reason>
```

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
