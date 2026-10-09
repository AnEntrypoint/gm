---
name: gm-hop
description: Self-contained gm node traversal. One hop advocates one book's discipline across the whole gm project at maximum extent: it audits every surface against every claim of the discipline, changes what it can witness, records every remaining gap as a verified PRD row, and nominates the next node from the graph's edges by the biggest need it found, with the rhetoric for the handover. Invoke with args "node=<ID>; book=<title>; author=<author>; rhetoric=<text>; visited=<IDs>; depth=<n>".
---

# gm-hop

One hop advocates one book's discipline for the whole gm project. The node is a book and
its author. Advocate it as its author would: state its claims, then test every surface of
the project against every claim, and do not stop at the first gap. Every gap the discipline
can name becomes a PRD row. The hop ends by handing the biggest need it found to the next
node, with rhetoric that carries the argument on.

## Arguments

- `node=<ID>`: the principle node you are visiting, for example `JTBD`.
- `book=<title>`: the work that states the discipline.
- `author=<author>`: its author. If the node names none, use `unattributed`.
- `rhetoric=<text>`: the argument handed over by the previous hop, with its open question. Empty for
  the first hop of a chain.
- `visited=<IDs>`: nodes already visited in this walk, separated by `,`. Never nominate one of them.
- `depth=<n>`: hops before this one. Empty means 1.

If `node` or `book` is missing, answer `VERDICT: NOT-APPLICABLE` naming the field, and stop.

## Harness

Dispatch gm verbs with the bundled CLI from `/config/workspace/gm`:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch <verb> --body '<json>' --cwd /config/workspace/gm

Use your own SESSION_ID in every body. Code questions: `codeinsight` (`callers`/`impact`) first,
then `codesearch` with `mode:"literal"`. `Read` only a located path. Never use raw `grep`, `find`
or `git` in Bash.

## Step 1: take up the rhetoric

If `rhetoric` is set, argue its open question from this book's discipline, in one paragraph, in
the author's terms. If it is empty, open with the weakest claim you can find for this discipline.

## Step 2: state the discipline's claims

List the claims this book makes that can be tested on a project. Write each as one checkable
sentence in the author's terms, with its test. Aim for every claim the book makes that bears on
software, documents or agent workflows. A claim with no test is not yet a claim.

## Step 3: audit every surface

Enumerate the project's surfaces with `codesearch`: `skills/*/SKILL.md`, `.gm/instructions/*.md`,
`docs/*.md`, `AGENTS.md`, `README.md`, `SKILLS.md`, `scripts/`, `bin/`, `install.sh`, `install.ps1`,
`gm-mcp/`, `gm-plugkit/`. For each claim, test each surface. Read only the located lines. A
violation, or a place the claim is missing where it applies, is a finding.

## Step 4: verify every finding before you write it

For each finding, print the cited lines and confirm the defect text is there:

    sed -n 'START,ENDp' /config/workspace/gm/<file>

If the text is absent, fix the citation or drop the finding. A row that cites absent text is never
written, because stale rows block executors.

## Step 5: change what you can, witness it

A finding you can close now, in one file with no uncommitted changes from another writer
(`git_status` with `paths`), you change with exact-match Edit. Witness the change through its live
entry point, read the reply, and keep its `dispatch_id`. A change without a live witness is
reverted.

## Step 6: record every remaining gap as a PRD row

Every other verified finding becomes one PRD row, one dispatch per row. There is no cap: record
every gap the discipline names. These rows are closed by the `gm-exec` run, which holds the nine
stages, mutables and witnesses:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-add --body '{"session_id":"<your SESSION_ID>","id":"<NODE>-<TAG>-<n>","subject":"<the gap: file, lines, the claim it breaks, the change>"}' --cwd /config/workspace/gm

`<TAG>` is the last six characters of your SESSION_ID. Before each `prd-add`, read the id with
`prd-list` and `{"id":...}`, because an existing id is overwritten. Read each row back after you
add it. A question you cannot answer by a run is a mutable: `mutable-add`, so the executor can close
it by a live run.

Resolve a row only with `prd-resolve` and `witness_dispatch_id` set to the dispatch id of a live
witness. If `witness_dispatch_id_verified` is `false`, the row stays pending, and you say so.

## Step 7: find the biggest need

Group your rows by surface, and by the claim each one breaks. The biggest need is the surface or
claim with the most rows that no candidate discipline already covers, or the single gap with the
largest effect on the project. Name it in one sentence with its row ids.

## Step 8: nominate the next node by that need

List the outgoing edges of your node from the graph. Those are the candidates:

    node -e 'const g=require("/config/workspace/gm/skills/dream-rsi/gm-graph.json"); const n=process.argv[1]; const L=Object.fromEntries(g.nodes.map(x=>[x.id,x.label])); console.log(g.edges.filter(e=>e.from===n).map(e=>e.to+"|"+(L[e.to]||"")).join(";"))' <NODE>

Drop every candidate in `visited`. From the rest, pick the candidate whose discipline attacks the
biggest need from Step 7. If no candidate attacks it, pick the one that attacks the next biggest.

Write the rhetoric for the handover, in at most three sentences:

- the biggest need, with its row ids;
- the open question the next discipline must answer about it;
- what the next hop should advocate across the project, and the surface to start from.

Then list the chosen candidate's outgoing edges, dropping `visited` and your node, as its candidates:

    node -e 'const g=require("/config/workspace/gm/skills/dream-rsi/gm-graph.json"); const n=process.argv[1]; const L=Object.fromEntries(g.nodes.map(x=>[x.id,x.label])); console.log(g.edges.filter(e=>e.from===n).map(e=>e.to+"|"+(L[e.to]||"")).join(";"))' <NEXT_NODE>

Spawn the successor with the Agent tool. The brief is one call, and nothing else:

    Skill(skill="gm-hop", args="node=<NEXT_NODE>; book=<NEXT_BOOK>; author=<NEXT_AUTHOR>; rhetoric=<NEXT_RHETORIC>; visited=<visited plus your node>; depth=<depth+1>")

Do not spawn when `depth` is 6 or more. At depth 6 the chain ends: write `NEXT: none, depth limit`.

## Useful work

A hop is useful only if it leaves something checkable: a witnessed change, or one or more verified
PRD rows. A hop that leaves neither has failed. Say why, and write `NEXT: none`. A hop that did useful
work but has no candidate left writes `NEXT: none, no candidates`, and the orchestrator takes over.

## Output

At most 120 words:

    VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
    CLAIMS: <claims tested, surfaces audited>
    CHANGED: <file and witness dispatch id, or none>
    ROWS: <count, and the id and cited line of each row>
    NEED: <the biggest need, in one sentence>
    NEXT: <NEXT_NODE and depth, or none with the reason>
