---
name: gm-hop
description: Self-contained gm node traversal. One hop applies one book's discipline to the gm project: it changes what the discipline calls for, records the findings it cannot finish as verified PRD rows, and nominates the next node from the graph's edges with the rhetoric that carries the argument on. Invoke with args "node=<ID>; book=<title>; author=<author>; rhetoric=<text>; visited=<IDs>; depth=<n>".
---

# gm-hop

One hop is one visit to one principle node of the gm graph. Each principle node is a
book and its author. A hop applies that book's discipline to the project, leaves
something checkable behind, and hands the argument to the next node. Everything a hop
needs is in this file: no other skill is loaded and no other agent is spawned for
the hop's own work.

## Arguments

- `node=<ID>`: the principle node you are visiting, for example `JTBD`.
- `book=<title>`: the work that states the discipline.
- `author=<author>`: its author. If the node names none, use `unattributed`.
- `rhetoric=<text>`: the argument handed over by the previous hop, with its open question.
  Empty for the first hop of a chain.
- `visited=<IDs>`: nodes already visited in this walk, separated by `,`. Never nominate one of them.
- `depth=<n>`: hops before this one in the chain. Empty means 1.

If `node` or `book` is missing, answer `VERDICT: NOT-APPLICABLE` naming the field, and stop.

## Harness

Dispatch gm verbs with the bundled CLI from `/config/workspace/gm`:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch <verb> --body '<json>' --cwd /config/workspace/gm

Use your own SESSION_ID in every body. Code questions: `codeinsight` (`callers`/`impact`)
first, then `codesearch` with `mode:"literal"`. `Read` only a located path. Never use raw
`grep`, `find` or `git` in Bash.

## Step 1: take up the rhetoric

If `rhetoric` is set, argue its open question from this book's discipline, in one
paragraph, in the author's terms. If it is empty, open with the weakest claim you can find
in the project for this discipline.

## Step 2: find where the discipline changes the project

Use `codesearch` to find the places the discipline applies: skill prose, served prose
in `.gm/instructions/`, scripts, code under `gm-mcp/`, `gm-plugkit/`, `bin/`, and docs.
Read only the located lines. If the discipline cannot touch the project, answer
NOT-APPLICABLE with one line of reason and write `NEXT: none`.

## Step 3: verify before you write

For every finding, print the cited lines and confirm the defect text is there:

    sed -n 'START,ENDp' /config/workspace/gm/<file>

If the text is absent, fix the citation or drop the finding. Stale rows block executors, so
a row that cites absent text is never written.

## Step 4: change what you can, witness it

If a finding is a change you can finish now, and its file has no uncommitted changes from
another writer (`git status --short <file>` through `git_status`), make it with exact-match
Edit. Witness the change through its live entry point, read the reply, and keep its
`dispatch_id`. A change without a live witness is reverted.

## Step 5: record what you cannot finish as PRD rows

Every remaining verified finding becomes one PRD row, one dispatch per row. These rows
are executed by the `gm-exec` executor, which runs the nine stages:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-add --body '{"session_id":"<your SESSION_ID>","id":"<NODE>-<TAG>-<n>","subject":"<the work, with file and line>"}' --cwd /config/workspace/gm

`<TAG>` is the last six characters of your SESSION_ID. Before each `prd-add`, read the id
with `prd-list` and `{"id":...}`: an existing id is overwritten, so pick the next free `<n>`.
Read each row back after you add it.

A question the row cannot answer is a mutable. Record it with `mutable-add`, so the executor
can close it by a live run.

## Step 6: resolve only with a witness

Resolve a row only with `prd-resolve`, `witness_dispatch_id` set to the dispatch id of your
live witness. If `witness_dispatch_id_verified` is `false`, the row stays pending and you
say so.

## Step 7: nominate the next node

Every node has edges to other nodes, and those edges are the candidates. List the outgoing
edges of your node from the graph:

    node -e 'const g=require("/config/workspace/gm/skills/dream-rsi/gm-graph.json"); const n=process.argv[1]; const L=Object.fromEntries(g.nodes.map(x=>[x.id,x.label])); console.log(g.edges.filter(e=>e.from===n).map(e=>e.to+"|"+(L[e.to]||"")).join(";"))' <NODE>

Drop every candidate listed in `visited`. From the rest, pick the one whose discipline attacks
the weakest claim you found. Its label gives its book and author. Write its rhetoric in one or
two sentences: the open question, and the argument it must take up.

Then list that candidate's own outgoing edges, dropping `visited` and your node, and pass
them as its candidates:

    node -e 'const g=require("/config/workspace/gm/skills/dream-rsi/gm-graph.json"); const n=process.argv[1]; const L=Object.fromEntries(g.nodes.map(x=>[x.id,x.label])); console.log(g.edges.filter(e=>e.from===n).map(e=>e.to+"|"+(L[e.to]||"")).join(";"))' <NEXT_NODE>

Spawn the successor with the Agent tool. The brief is one call, and nothing else:

    Skill(skill="gm-hop", args="node=<NEXT_NODE>; book=<NEXT_BOOK>; author=<NEXT_AUTHOR>; rhetoric=<NEXT_RHETORIC>; visited=<visited plus your node>; depth=<depth+1>")

Do not spawn when `depth` is 6 or more. At depth 6 the chain ends: write `NEXT: none, depth limit`.

## Useful work

A hop is useful only if it leaves something checkable: a witnessed change, or one or more
verified PRD rows. A hop that leaves neither has failed. Say why, and write `NEXT: none`.
A hop that did useful work but has no candidate left writes `NEXT: none, no candidates`, and
the orchestrator takes over the chain.

## Output

At most 100 words:

    VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
    CHANGED: <file and witness dispatch id, or none>
    ROWS: <id and cited line of each verified row, or none>
    NEXT: <NEXT_NODE and depth, or none with the reason>
