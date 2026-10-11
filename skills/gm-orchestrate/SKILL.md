---
name: gm-orchestrate
description: Traversal protocol for a gm walk. A walk is the traversal of gm-graph nodes; the frontier count, ledger and tick logging are attributes of those traversals. Owns every traversal rule.
---

# gm-orchestrate

The walk is node traversal. There is no separate pool loop: a launch, a completion and a refill are all moves of one traversal.

## Node and payload
- A node is one principle of `C:/dev/gm/skills/dream-rsi/gm-graph.json` applied to one surface. That file is the private traversal order: only the orchestrator reads it. Its fields are `id`, `label` (`Author - Title`), `author`, `book`, `kind`, and its `edges`.
- The orchestrator builds one payload per traversal from the private file: `{id, label, advocate, links:[{to, guards}]}`. `label` is the discipline the worker runs first. `advocate` is the node's advocate spec. `links` are the node's outgoing connections, each `{to, guards}`, sorted lexically by `to`, with `guards` taken from the edge's `condition`. Nothing else is sent: no `from`, no position, no direction, no edge kind.
- Gating runs both ways. A link may route to any state whose guards hold, including a state already traversed earlier in the walk. Nothing in the walk forbids or special-cases that.
- Node ids are never renamed. A row (gm-prd) is not a node.

## Traversal
- Entering a node is a launch: `Skill(skill="gm-hop", args='{"node":<payload>,"surface":"<path>","session":"<parent>-<k>","wave":"<wave>","depth":<n>}')`. A launch line `launch <SESSION_ID> surface=<path> node=<id> row=-` is written before the spawn.
- A completed traversal's receipt `next:` names one link from its payload whose guards hold on the surface. Its receipt is the only source of successors.
- Refill is the same move: a completed traversal's nominated node is entered on the freed frontier. A nomination is advisory until the node's own surface is confirmed free (below).
- A completed traversal writes `done <SESSION_ID>` as its last act, on every verdict, including NOT-APPLICABLE.
- A parked `.gm/pool/<session>.next` spec is a nominated node waiting for a free slot; it is entered before any fresh node on its frontier. The orchestrator deletes a parked spec only after its traversal's receipt is non-NOT-APPLICABLE.
- A frontier is one line of traversal: a root node and the nodes it nominated. A traversal entered on a held surface is refused: take the next nominated node.

## Floor and shortfall
- `floor` = min(10, measured ceiling). The measured ceiling is N from the latest spawn refusal ("can run N subagents at once"); 20 until one is seen.
- Count = frontier nodes under traversal at once (principle nodes only; rows excluded), read from the ledger after every entry and every completion: ids with a `launch` line and no `done` line after the last `wave <UTC>` line. Fold: `awk '/^wave /{delete l; delete d} /^launch /{l[$2]=1} /^done /{d[$2]=1} END{n=0; for(k in l) if(!(k in d)) n++; print n}' .gm/pool/ledger-<wave>.txt` (or the same fold in `exec_js`). `slots.live`, ListAgents and `.live` markers are not the count; a spawn refusal is the only ceiling signal.
- Shortfall: count < floor while some frontier has an unexplored link, meaning a completed node has a link whose guards hold and whose `to` has no traversal on that surface yet. A shortfall is logged as `FAILURE: <UTC> live=<n> floor=<f> frontier=<root> unexplored=<to> cause=<refusal|no-slice|headroom|drain>` in `.gm/witness-log.md`. A count below the floor with no unexplored link is not a shortfall: the walk opens a new root (below).
- Ledger and tick logging are attributes of the traversal, not steps. Each traversal that ends appends `tick <n> node=<id> surface=<path> live=<count> floor=<f> <UTC>` to `.gm/witness-log.md`.

## Roots and rollover
- When no frontier has an unexplored link and no parked spec or open row remains, the walk opens a new root: a `wave <UTC> n=<k>` line in the ledger resets the fold, and a node of the private graph whose surface has no live traversal (no launch without done naming it in `surface=`, no fresh `.gm/pool/*.live` naming it) becomes the root. Fuel is 40 completed traversals per wave.
- The walk stops only at a world-scoped one-way door, or when every node of the graph sits on a held surface. Terminal: `Skill(skill="gm-continue")` once the phase is terminal and no row is open.

## Attributes of a traversal
- **Heartbeat.** On entry a traversal writes `.gm/pool/<session>.live` (`session:`, `surface:`, `start:`); on exit it deletes it. A brief without this step is refused. Never delete a `.live` file to free a slot.
- **Spawn refusal.** The ceiling. Park the successor spec at `.gm/pool/<session>.next` and end the receipt with `HOP next-principle <NAME> <surface> (spawn blocked: ceiling; parked at .gm/pool/<session>.next)`. Probe again only after one completion notification, never in a loop.
- **Successors** are launched by the orchestrator, which builds the payload from the private graph and writes `launch <child>` before the spawn. The child writes `done <child>` last.
- **Dropped traversal** (`ECONNRESET`, `ECONNREFUSED`, `server_error`): resume that id once with `SendMessage`, naming its row, project and SESSION_ID; relaunch a fresh brief only if the resume is refused or the id is gone. Never resume a traversal whose row already has a live fresh agent. N drops of one wave inside one window is one drain: record one `FAILURE ... event=mass-drain-<N>` line, wait with `wait {"ms":120000}` (max 600000) before entering new nodes, and file a defect row (`<row>-mass-drain-<session>`) on a third drain.
- **Starved git or state verb.** Re-dispatch the same body once, byte-identical; never `resume_task`. A second starvation files a row naming the paths and dispatch ids, and no further git dispatch is made until a completion notification drains the queue.
- **Headroom.** CPU at or above 80% or free memory below 2048 MB pauses new entries; the traversal in flight continues. Log the cause with the real count.
- **Locks and browsers.** A GPU node waits on `.gpu-lock/owner.json`; a browser node waits on the shared lease; a timed-out lock is a failed run. Browsers are headful. Node nodes keep traversing meanwhile.

## Editing the skills
- Check `C:/dev/gm/.git/MERGE_HEAD` before an edit; while it is set, defer the edit.
- Re-read every edited skill file after any pull, and re-apply any clobbered hunk.
- Publish through the GitHub Git API on `main`, with the base tree from the current remote tip and the blob SHA-1s checked against the expected pre-edit blobs first.
- One commit author, `lanmower`, no trailers.

## Second tracker: PRD resolution
- A PRD row is resolved on its own ledger, separate from the traversal. `Skill(skill="gm-prd", args="row=<id>; session=<SID>")` closes one row; its stages and their gates live in gm-prd. Its receipts are `.gm/receipts/<row>/NN-<STAGE>.md`.
- A row's stage state never changes the frontier count, and a row is never counted as a live node. A traversal that files rows (`prd-add`) and a row that resolves are independent of the frontier floor.
- Open rows and the verifier pass (a verifier under a SESSION_ID that executed none of the rows checks its diff against the row text; only passing rows are delivered) belong to this tracker.

## Fan-out
- Each traversal's brief opens with: "use the gm skill for this; code questions go to codeinsight (`callers`/`impact`) first, then the code-search port, and `Read` only a located path." It carries its own SESSION_ID.
- Traversal workers are gm-hop, and row workers are gm-prd on the second tracker. Neither is a fork.
- A brief names a source path only after confirming it exists in the target project.
- Hops and executors share one pool of frontiers. A collision is recovered by re-reading the row or file, reapplying on current state, and retrying.
