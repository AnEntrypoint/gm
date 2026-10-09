---
name: gm-hop
description: One gm-graph hop, a complete coding-agent run for one book's discipline. The agent applies that discipline across the project to perfect it, claims each file before editing it, makes and witnesses the changes, resolves its PRD rows, and spawns the nominated next hop with the rhetoric that carries the work on. Invoke with args "node=<ID>; book=<title>; author=<author>; depth=<n>; rhetoric=<handed-over argument>".
---

# gm-hop

A hop is a complete coding-agent run for one discipline. It does not review and
stop. It works out what its discipline asks of the project, does that work, proves
each change against the live system, and then hands the next discipline the
argument that carries the project further. The node is a book and its author; the
book's method is the work to apply.

## Arguments

- `node=<ID>`: the principle node ID, for example `JTBD`.
- `book=<title>`: the work that states the discipline.
- `author=<author>`: its author. Empty if the node names none.
- `depth=<n>`: how many hops precede this one. Empty means 1.
- `rhetoric=<text>`: the argument handed over, with the open question it leaves.

If `node` or `book` is missing, answer `VERDICT: NOT-APPLICABLE` naming the missing
field, and stop.

## Scope

The project is `/config/workspace/gm`. Apply the discipline across every part of it
that the discipline can improve: `skills/`, `.gm/instructions/`, `AGENTS.md`,
`README.md`, `docs/`, `scripts/`, and the code under `gm-mcp/`, `gm-plugkit/`, and
`bin/`. Use `codesearch` to find every occurrence of a rule, and `Read` only a
located path. Use `codeinsight` `callers` and `impact` before changing a function.

## Claims: required before any edit

Two hops must never edit one file at once. Before you edit a file, claim it:

1. Read the row `CLAIM-<path with / replaced by ->` with `prd-list` and `{"id":...}`.
   If it exists and is pending, another hop holds the file. Do not edit it. Record
   a row for your finding and move on.
2. If it does not exist, create it with one dispatch:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-add --body '{"session_id":"<your SESSION_ID>","id":"CLAIM-<path>","subject":"claimed by <SESSION_ID> for <NODE>"}' --cwd /config/workspace/gm

3. Read the row back to confirm the claim is yours before you edit.
4. Resolve the claim when you finish that file. Resolve it with a witness that names
   the change.

## Procedure

1. Frame. State the discipline's field in one paragraph, in the author's terms. Then
   read the project state that the discipline governs.
2. Plan. List every change the discipline calls for across the project. Create one
   PRD row for each, one dispatch per row, with ids `<NODE>-<n>`:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-add --body '{"session_id":"<your SESSION_ID>","id":"<NODE>-<n>","subject":"<the change: file:line, the defect, the fix>"}' --cwd /config/workspace/gm

   Never batch rows. Keep each subject to one change.
3. Execute. For each row you can claim, claim its files, make the smallest change
   that closes the row, and witness it through its real entry point. For served
   prose, dispatch `instruction` and read the served text. For a verb, dispatch the
   verb and read its reply. For a skill, invoke it and read its output. Then resolve
   the row:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-resolve --body '{"session_id":"<your SESSION_ID>","id":"<NODE>-<n>","witness_evidence":"<the live line that proves the change>"}' --cwd /config/workspace/gm

   A row you cannot claim or witness stays pending, with a one-line note in the
   verdict.
4. Iterate. Re-read the project after your changes, and repeat steps 2 and 3 for
   every new finding. Stop only when the discipline has no further change it can make
   to the project, or the depth bound is reached.
5. Nominate. Choose the principle node whose discipline attacks the largest pending
   or weakest part of the project. Write its rhetoric as one or two sentences that
   state the open question and the argument it must take up. Spawn that hop with the
   Agent tool, and open its brief with the brick-wall opener from the gm skill, then
   one call:

       Skill(skill="gm-hop", args="node=<NEXT_ID>; book=<NEXT_BOOK>; author=<NEXT_AUTHOR>; depth=<depth+1>; rhetoric=<NEXT_RHETORIC>")

   Do not spawn when depth is 6 or more. At depth 6, end the chain and report.

## Output

At most 200 words, no preamble:

    VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
    CASE: <the author's strongest point, one sentence>
    ROWS: <created, resolved, pending: the IDs of each>
    FILES: <the files you changed, each with its claim resolved>
    WITNESSES: <one live line per resolved row>
    NEXT: <NEXT_NODE and depth, or "chain ended at depth N">

VERDICT is HOLDS when the project under this discipline is already sound and you
found nothing to change. VIOLATED when you found and fixed or recorded changes.
NOT-APPLICABLE only when the discipline cannot touch the project, with one line of
reason.

## Rules

- Do not commit or push. The orchestrator commits after the wave returns.
- No test files, ever. Witness with the live system.
- Claim before you edit. Never edit a file another hop holds.
- Use the word "hop" for this unit of work and nothing else in your output.
