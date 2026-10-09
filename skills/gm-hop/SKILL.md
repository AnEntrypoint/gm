---
name: gm-hop
description: One gm-graph hop. Applies one book's discipline to the gm project, witnesses the change, and nominates the next node. Invoke with args "node=<ID>; book=<title>; author=<author>; rhetoric=<text>".
---

# gm-hop

A hop applies one discipline to the gm project. The node is a suggestion: a book
and its author. Use the discipline as its author would, and nominate the next node.

## Arguments

- `node=<ID>`: the principle node ID, for example `JTBD`.
- `book=<title>`: the work that states the discipline.
- `author=<author>`: its author. Empty if none.
- `rhetoric=<text>`: the argument handed over by the previous hop.

## Do

1. Read the rhetoric and argue it from this book's discipline.
2. Read the parts of `/config/workspace/gm` the discipline governs. Use `codesearch`
   to find them.
3. Make the change the discipline calls for. Witness it live: dispatch the verb or
   read the served text it touches. Do not commit.
4. If work remains that you do not do now, add one PRD row for it:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-add --body '{"session_id":"<your SESSION_ID>","id":"<NODE>-<TAG>","subject":"<the work, with file and line>"}' --cwd /config/workspace/gm

   `<TAG>` is the last six characters of your SESSION_ID.

## Nominate

Choose the next principle node from the graph (`kind` is `principle` in
`skills/dream-rsi/gm-graph.json`). Pick the one whose discipline attacks what you
found weakest. Write its rhetoric in one or two sentences. Then spawn it with the
Agent tool. Open the brief with the brick-wall opener from the gm skill, then:

    Skill(skill="gm-hop", args="node=<NEXT_ID>; book=<NEXT_BOOK>; author=<NEXT_AUTHOR>; rhetoric=<NEXT_RHETORIC>")

## Output

At most 80 words:

    VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
    CHANGED: <files, or none>
    NEXT: <NEXT_NODE>
