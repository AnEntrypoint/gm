---
name: gm-hop
description: "Use when a gm walk must apply one named principle (book or discipline) to a code surface and move on to the next principle: it applies the principle to every in-scope instance in one pass and returns one receipt naming the next principle, so the traversal advances with witnessed changes or filed PRD rows. Owns the hop rules; pool rules are defined in gm-orchestrate. Invoke only from gm; do not load directly."
---

# gm-hop

Args: one JSON object `{"node":{"id":"<id>","label":"<Author - Title>","advocate":"<advocate spec>","links":[{"to":"<id>","guards":["<guard>"]}]},"surface":"<path>","session":"<SESSION_ID>","wave":"<wave>","depth":<n>,"rhetoric":""}`. `links` is sorted lexically by `to`. The payload is the only graph data a hop receives: never load `gm-graph.json`. `rhetoric`, `max_depth` (default 6, the wave's cap) and `wave` (names `.gm/pool/ledger-<wave>.txt`) are optional; `wave` is required for ledger lines. Missing `node`, `surface` or `session`: `VERDICT: NOT-APPLICABLE`, no writes.

Verbs: gm section 1. Code questions: codeinsight first, then `codesearch` literal rooted at the surface. `fs_read` only located paths.

## Procedure

The orchestrator writes ledger `launch` and `done` lines (gm-orchestrate, Tick), except the hop's final `done` (step 7).

0. Run the discipline named by `node.label` (e.g. `Meyer - Design by Contract`) on the surface, with `node.advocate` as spec. A link is nominable only when every guard in `node.links` holds; nominate only after the discipline has run. Never rename node ids.
1. Argue `rhetoric`'s open question in one paragraph, or the principle's weakest claim if empty.
2. List testable claims, one checkable sentence each, with its test.
3. `codesearch` every instance a claim governs on the surface. Print cited lines; drop absent text.
3a. If the surface asserts a cause, defect or fix, run ACH (`../gm/prose/ach.md`) first: at least two rival hypotheses, a `C`/`I`/`N` matrix from dispatch-backed evidence, rank by fewest `I` cells, and one probe separating the leader. Step 4 acts only on the leader.
4. Close what one exact-line change written through `fs_write` closes, if no other writer holds the file (`git_status` with paths). Witness it live (keep the dispatch id); revert any change without a live witness.
5. Before each `prd-add`, `codesearch` `.gm/prd/` for the finding's cause literal (verb name or file path). On a hit, witness that row if this hop owns it, else cite its id; add nothing. Otherwise `prd-add` `<principle>-<SESSION_ID>-<n>` with the full SESSION_ID, never a suffix, and body field `"origin":"traversal"`: `prd-add` refuses a traversal row while 20 or more rows are pending and the refusal names that count (drain first). `prd-add` refuses an existing id unless `overwrite:true`, so a refused id takes the next `<n>`; never send `overwrite` for another session's row. Retire or merge one stale row per row added. The reply's `public_search` block starts that row's reference subagent (gm-prd, stage 0). An order, rank or choice discipline (PERT, MoSCoW, Pugh, Wardley) files no row: it writes that ordering as `blockedBy` edges or a merged `acceptance_criteria` on the target rows.
6. Name the biggest need in one sentence.
7. Nominate the next node: an eligible link whose `to` attacks the need, whatever its position or history. At `depth` >= `max_depth`: `next: none, depth limit`. Otherwise `next:` names the link's `to` and `depth+1`; `rhetoric` = your `next_choice.why` verbatim (three sentences max). The orchestrator builds the child payload from the private graph, appends `launch <child-session> surface=<surface> row=-` to `.gm/pool/ledger-<wave>.txt`, and spawns the child. Every verdict ends with `fs_write {"path":"<path>","content":"done <session>\n","append":true,"run_end":true}`; the `run_end` stamp is the end-of-run marker read by `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_cycle.rs` (`ended`). Shared logs take appends only (`fs_write {"path":"<path>","content":"<line>\n","append":true}`).
8. Close the hop's own Dream-RSI cycle before the receipt: dispatch `dream-replay-cycle` with `{"session_id":"<session>"}` (retry once if refused) and record its id and status (`replayed`, or `deferred` with the cause) in `CYCLE:`.

No witnessed change or verified row: `next: none`, with the reason.

## Node emission

A hop EMITS a node on EVERY verdict, including NOT-APPLICABLE; a receipt summary is not emission. Write `.gm/lean-walk/<NODE>.<SESSION>.json` (keyed by node and owner session; overwrite only this session's file) before the Receipt, and before the orchestrator calls `subagent-end`: `subagent-end` refuses a `done` hop whose receipt file is missing (`hop receipt missing`).
```
{node, applied, changes, witness, prd_ids, unknown_ids, next_choice:{to,why},
 links_offered:[<to>, ...], link_taken:<to|null>, session, witness_dispatch_ids:[<dispatch id>, ...],
 verified_by:<session>|null, verified_dispatch_ids:[<dispatch id>, ...],
 findings:[{prd_id, owner, disposition:accept|merge|reject}], inspector:<session>|null}
```
- `findings`: every PRD row this hop filed or cited. `owner` is the session holding the row; `disposition` is `accept` until the orchestrator writes otherwise. `inspector` is the judge session, or `null`.
- `links_offered` = the `to` of every entry of `node.links`, verbatim. `link_taken` = the `to` nominated in `next:`, or `null` at `next: none`.
- `applied:true` only when >=1 change landed AND `witness` names a dispatch you hold. `witness_dispatch_ids` lists the dispatch ids the witness quotes; `../dream-rsi/SKILL.md` Part B step 4 rejects the record if one is absent from `.gm/dream-rsi/<session>/observations.json`.
- The hop never witnesses its own edit. Before `applied:true`, verifier session `<session>-v1` gets only the change contract (file, expected edit, witness command) and re-runs the witness live; record `verified_by:"<session>-v1"` and its ids. No verifier pass: `applied:false`, `verified_by:null`. `../dream-rsi/SKILL.md` Part B step 2 counts a walk only when `verified_by` differs from `session`.
- Stamp `lean_node:"<NODE>"` on your dispatches (read by `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs`; recorded by `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`).
- A discipline the surface demands that `links_offered` lacks is emitted, not dropped: `fs_write` with `append:true` adds `{id,label,book,author,kind:"principle",proposed_by:<node.id>,session,witness}` to `.gm/lean-walk/new-nodes.jsonl` (`id` = upper-case slug of the book title). Refuse an `id` already in `nodes[]`; join that node instead. Never edit `../dream-rsi/gm-graph.json`; its owner promotes nodes.
- Evidence budget: the node file keeps verdict fields and pointers; a bulky array moves to `.gm/lean-walk/<NODE>-<field>.json`. Under 4 KB. `.gm/lean-walk/` is gitignored: no commit, no push.

## Rules

- A receipt is the hop's own: a successor is named by session in `next:`, with no child text. The orchestrator reads each receipt by the session it launched, and merges a principle already filed by another wave instead of adding it again.
- A hop is one named principle from the book "lean" (AnEntrypoint/lean), applied to every in-scope instance in one pass, as its own subagent with its own SESSION_ID. It is one lane, never the pool; the orchestrator never performs hop work inline (gm-orchestrate, Never let the pool dip).
- A hop reads pending rows once at start in one `gm_codemode` body (`prd-list {"status":"pending","limit":<n>}`), filtered in code to its principle or cause literal. It nominates its successor from that list and never invents an id.
- Choose the next node by project fit and diversity. Traversal is unfinished until earlier applied nodes that a later change may affect are re-checked (back-verify).
- Each confirmed node-only row is `prd-add`ed at once, never batched. A hop with zero rows 15 minutes after its heartbeat start returns a receipt (surfaces scanned, candidates checked, rows logged 0, reason).
- A NOT-APPLICABLE receipt never deletes `.gm/pool/<session>.next`; only the orchestrator does, after relaunch is accepted.
- A hop creates PRDs, never executes its own. Merge duplicate outcome rows (`outcome-hop-*`, `cpu-hop-outcome-*`) into the base row; never add them.
- The receipt names an executed witness (a command, browser result, codesearch output); a receipt without one is refused.
- A hop dying with `Prompt is too long` is relaunched compact, never resumed (gm-orchestrate, cause 4): principle, surface, depth, `visited` and a three-sentence `rhetoric` only. Spawns pass located `path:line` citations, never a transcript or file body.
- A hop never dispatches the `gm-continue` skill; that is the parent orchestrator's terminal move. A hop ends on its receipt, plus the parked line when it names a successor.
- Git: a hop commits, never pushes or pulls. At most one `git_status {paths}` and one `git_commit {paths}` (explicit `paths`); `branch_status` only when remote state is needed, once. The orchestrator publishes once per wave (gm-orchestrate, Shared-tree publish); an unpushed commit is recorded by sha. Author and trailers: gm, Autonomy.
- Starved git verb: one re-dispatch (gm-orchestrate, Starvation); a second starvation files a PRD row naming the commit sha and stops. A `gate_denied` remote-moved refusal is the orchestrator's (gm-orchestrate, Shared-tree publish).
- Re-bake in the same commit as the source edit. Before `git_commit`, `codesearch` `BAKE_INPUTS_` (and `HEIGHTFIELD_BAKE`, `MINIMAP_BAKE`, `GLB_TRANSFORM`, `KTX2_EXTRACT`, `PROGRESSIVE_BAKE`, `SNAPSHOT_ENCODE`, `COLLISION_GRID`) for declared bake-input closures. If a touched path is in one, re-run that closure's generator, commit every artifact it produces in the same path-scoped commit, and require the cache-key check to exit 0 first.
- A successor spawn refused by the concurrent-subagent ceiling retries once when a slot frees. Refused again, park it, never drop it: write `.gm/pool/<session>.next` (principle, surface, depth, `visited`, `rhetoric`, witness id) and end with `HOP next-principle <NAME> <surface> (spawn blocked: ceiling; parked at .gm/pool/<session>.next)`. Never re-spawn in a loop.
- A `prd-add` refusal names one row file, `.gm/prd/<id>.yml`: fix that file only (writes are compare-and-swap of it), retry once, then repair or remove it and re-add the row.

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

The rule in `../gm/SKILL.md` (Finish the work) applies to every hop unchanged.
