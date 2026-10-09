---
name: gm-hop
description: One gm-graph hop. Applies one book's discipline to a witnessed change in the gm project, or records verified rows, then nominates the next node. Invoke with args "node=<ID>; book=<title>; author=<author>; rhetoric=<text>; candidates=<list>".
---

# gm-hop

A hop applies one discipline to the gm project. The node is a book and its author.
A hop is useful only when it leaves something checkable behind: a witnessed change,
or one or more verified PRD rows. A hop that leaves neither has not done useful work.

Code questions: `codeinsight` (`callers`/`impact`) first, then `codesearch`. `Read`
only a located path.

## Arguments

- `node=<ID>`: the principle node ID, for example `JTBD`.
- `book=<title>`: the work that states the discipline.
- `author=<author>`: its author. Empty if none.
- `rhetoric=<text>`: the argument handed over by the previous hop.
- `candidates=<list>`: the nodes this node can go to, as `ID|book|author` entries
  separated by `;`. Only these are valid successors.

## Do

1. Read the rhetoric and argue it from this book's discipline, in one paragraph.
2. Find the place the discipline changes the project. Use `codesearch` and read only
   the located lines. Stop if you find no such place: answer NOT-APPLICABLE with the
   reason, and write `NEXT: none`.
3. Check the files you would change: `git status --short <file>`. If another writer
   has uncommitted changes in that file, do not edit it. Record a verified row for
   the change instead (step 5).
4. If the file is free, make the change. Witness it live: dispatch the verb, or read the
   served text it touches, and keep the reply. A change without a witness is reverted.
5. Verify every row before you write it. Print the cited lines and confirm the defect
   text is there:

       sed -n 'START,ENDp' /config/workspace/gm/<file>

   If the text is absent, fix the citation or drop the finding. Stale rows block
   executors, so a row that cites absent text is never written.

6. Write one PRD row per remaining verified finding:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-add --body '{"session_id":"<your SESSION_ID>","id":"<NODE>-<TAG>","subject":"<the work, with file and line>"}' --cwd /config/workspace/gm

   `<TAG>` is the last six characters of your SESSION_ID. Read each row back with
   `prd-list` and `{"id":...}`.

A row is resolved only with a witness: `prd-resolve` with `witness_dispatch_id` set to
the dispatch id of your live reply. If `witness_dispatch_id_verified` is `false`, the
row stays pending, and you say so.

## Useful work

Your output must name at least one of: a witnessed change (file and witness dispatch
id), or a verified row (id and cited line). If you have neither, the hop has failed:
say why, and write `NEXT: none`.

## Nominate: required when useful work was done

Name exactly one successor from `candidates`: the candidate whose discipline attacks
what you found weakest. Write its rhetoric in one or two sentences.

If you did useful work and cannot name a successor, write `NEXT: none` and say why.
The orchestrator then names one from the node's outgoing edges (gm skill Section 1d,
successor recovery). If you did no useful work, write `NEXT: none` and do not
nominate: an empty hop does not extend the chain.

To hand the successor its own candidates, look up that node's outgoing edges:

    node -e 'const g=require("/config/workspace/gm/skills/dream-rsi/gm-graph.json"); const n=process.argv[1]; const L=Object.fromEntries(g.nodes.map(x=>[x.id,x.label])); console.log(g.edges.filter(e=>e.from===n).map(e=>e.to+"|"+(L[e.to]||"")).join(";"))' <NEXT_ID>

Then spawn the successor with the Agent tool. Open the brief with the brick-wall
opener from the gm skill, then one call:

    Skill(skill="gm-hop", args="node=<NEXT_ID>; book=<NEXT_BOOK>; author=<NEXT_AUTHOR>; rhetoric=<NEXT_RHETORIC>; candidates=<NEXT_CANDIDATES>")

## Output

At most 80 words:

    VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
    CHANGED: <file and witness dispatch id, or none>
    ROWS: <id and cited line of each verified row, or none>
    NEXT: <NEXT_NODE>, or none with the reason
