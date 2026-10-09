---
name: gm-hop
description: One gm-graph hop. Applies one book's discipline to the gm project, witnesses the change, and nominates the next node. Invoke with args "node=<ID>; book=<title>; author=<author>; rhetoric=<text>".
---

# gm-hop

A hop applies one discipline to the gm project. The node is a suggestion: a book
and its author. Use the discipline as its author would, and nominate the next node.

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

1. Read the rhetoric and argue it from this book's discipline.
2. Read the parts of `/config/workspace/gm` the discipline governs. Use `codesearch`
   to find them.
3. Make the change the discipline calls for. Witness it live: dispatch the verb or
   read the served text it touches. Do not commit.
4. Verify before you write. For each finding, print the cited lines and confirm the
   defect text is in them:

       sed -n 'START,ENDp' /config/workspace/gm/<file>

   If the defect is not there, fix the citation or drop the finding. Never write a row
   that cites text that is not in the file. Stale rows block executors.

5. If work remains that you do not do now, add one PRD row for it:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-add --body '{"session_id":"<your SESSION_ID>","id":"<NODE>-<TAG>","subject":"<the work, with file and line>"}' --cwd /config/workspace/gm

   `<TAG>` is the last six characters of your SESSION_ID.

A row is resolved only with a witness. Read the `prd-resolve` reply. If
`witness_dispatch_id_verified` is `false`, the row is not resolved: leave it
pending and say so in the output.

## Nominate: required

Name exactly one successor from `candidates`. This is the last thing you do, and
your output is incomplete without it. Pick the candidate whose discipline attacks
what you found weakest, and write its rhetoric in one or two sentences.

If you cannot name a successor, write `NEXT: none` and state why. The orchestrator
then names one for you from the outgoing edges of your node, using the gm skill
Section 1d recovery. A missing NEXT is never silently dropped.

To hand the successor its own candidates, look up that node's outgoing edges:

    node -e 'const g=require("/config/workspace/gm/skills/dream-rsi/gm-graph.json"); const n=process.argv[1]; const L=Object.fromEntries(g.nodes.map(x=>[x.id,x.label])); console.log(g.edges.filter(e=>e.from===n).map(e=>e.to+"|"+(L[e.to]||"")).join(";"))' <NEXT_ID>

Then spawn the successor with the Agent tool. Open the brief with the brick-wall
opener from the gm skill, then one call:

    Skill(skill="gm-hop", args="node=<NEXT_ID>; book=<NEXT_BOOK>; author=<NEXT_AUTHOR>; rhetoric=<NEXT_RHETORIC>; candidates=<NEXT_CANDIDATES>")

## Output

At most 80 words:

    VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
    CHANGED: <files, or none>
    NEXT: <NEXT_NODE>, or none with the reason
