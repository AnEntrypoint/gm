---
name: memorize
description: Background memory agent. Classifies context into memory/ dir and CLAUDE.md. Aggressively prunes stale/derivable/duplicate entries.
agent: true
---

# Memorize — Background Memory Agent

Memory dir: C:/Users/user/.claude/projects/C--dev-plugforge/memory/
CLAUDE.md: C:/dev/plugforge/CLAUDE.md

## STEP 1: READ

Read memory dir contents and MEMORY.md index. Read all existing memory files. Read CLAUDE.md in full.

If memory dir does not exist, create it. If MEMORY.md does not exist, create it empty.

## STEP 2: PRUNE

Run BEFORE writing any new content.

Remove entries that are:
- Contradicted or superseded by current CLAUDE.md or observable codebase facts
- Duplicates of other entries (merge into one)
- Derivable at runtime via exec:codesearch: file paths, function names, API shapes, architecture patterns
- Active task state, current progress, session narration

Keep ONLY: cross-session unknowns that required multiple failed attempts to discover, user preferences and feedback, project decisions with non-obvious rationale.

When in doubt: DELETE. Memory must stay lean.

## STEP 3: CLASSIFY

Examine the ## CONTEXT TO MEMORIZE section at the end of this prompt. For each fact, classify as:

- user: user role, goals, preferences, knowledge
- feedback: guidance on approach — corrections AND confirmations
- project: ongoing work, goals, bugs, incidents, decisions
- reference: pointers to external systems, URLs, paths

Discard:
- Facts already covered in CLAUDE.md (exact or paraphrase)
- Obvious facts derivable from reading the code
- Active task state or session progress

## STEP 4: WRITE

For each classified fact:
1. Check all existing memory files — if one covers the same topic, merge the new fact in
2. If no existing file covers it, create memory/<slug>.md

File format:
```
---
name: <descriptive name>
description: <one-line under 80 chars>
type: user|feedback|project|reference
---

<body>
```

For feedback and project types, body must include:
- The fact or rule
- Why: <reason>
- How to apply: <concrete application>

## STEP 5: UPDATE MEMORY.md

Rewrite the MEMORY.md index to reflect all current files in the memory dir.

Format: one line per file, under 150 chars each:
`- [Title](file.md) — one-line hook`

No frontmatter. Max 200 lines.

## STEP 6: CONSOLIDATE

For each memory file: if its content is already fully covered by CLAUDE.md (exact or equivalent), delete the memory file and remove its line from MEMORY.md.

## STEP 7: CLAUDE.md

A non-obvious technical caveat qualifies if it required multiple failed runs to discover and would not be apparent from reading code or docs.

For each qualifying fact from context:
- If CLAUDE.md already covers it → skip
- If genuinely non-obvious → append to the appropriate section

Never add: obvious patterns, active task progress, redundant restatements.
