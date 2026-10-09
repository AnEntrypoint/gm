---
name: gm-hop
description: One gm-graph hop. A subagent critiques the gm skill's parallelism sections with one book's discipline, as its author argues it, at maximum scope, and records every defensible finding as a PRD row. Invoke with args "node=<ID>; book=<title>; author=<author>".
---

# gm-hop

One hop is one visit to one principle node of the gm graph. The node is a book
and its author. You argue that book's discipline with maximum force against the
subject, and you turn every defensible finding into a PRD row. A row is the only
output that outlives the hop.

## Arguments

`args` carries three fields, separated by semicolons:

- `node=<ID>`: the principle node ID, for example `JTBD`.
- `book=<title>`: the work that states the discipline, for example `Jobs To Be Done`.
- `author=<author>`: the author of that work. If the node names no author, the
  value is the empty string, and the hop treats the discipline as the node label.

If `node` or `book` is missing, answer `VERDICT: NOT-APPLICABLE` with the missing
field named, and stop.

## Subject

The subject is `/config/workspace/gm/skills/gm/SKILL.md` in full, with emphasis on
Section 1c (Parallelism contract) and Section 1d (Hops are discipline advocates).
Read the whole file. Also read `/config/workspace/gm/.gm/instructions/entry.md`
where it governs the same behavior. Read other files only where a cited line needs
its context.

## Procedure

1. State the strongest case for the discipline in the author's terms. Name the
   book, not a paraphrase.
2. Critique the subject at maximum scope. Every rule, threshold, number, verb,
   path, and missing check is in scope. Look for what the discipline requires,
   what it forbids, and what the subject silently assumes.
3. For each defensible finding, create one PRD row. Use one dispatch per row:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-add --body '{"session_id":"<your SESSION_ID>","id":"<NODE>-<n>","subject":"<finding: file:line, the defect, and the change>"}' --cwd /config/workspace/gm

   Number rows `<NODE>-1`, `<NODE>-2`, and so on. Keep each subject to one
   finding, with its file and line. Never batch rows into one body.
4. Keep critiquing until the discipline has no further defensible finding. Do not
   stop at the first gap. If the subject does not bear on the discipline, create
   no rows and answer NOT-APPLICABLE with one line of reason.
5. Read back what you created with `prd-list` and `{"id":"<NODE>-<n>"}`, so the
   verdict names only rows that exist.

## Output

At most 120 words, no preamble:

    VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
    CASE: <the author's strongest point, one sentence>
    ROWS: <the row IDs you created and confirmed, or "none">

## Rules

- Write no file. The only write is `prd-add`, one row per dispatch.
- Argue the book's case as hard as the book would. Do not hedge the verdict.
- Use the word "hop" for this unit of work and nothing else in your output.
