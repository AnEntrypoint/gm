---
name: memorize
description: Background memory agent. Classifies context and writes to AGENTS.md + rs-learn. No memory dir, no MEMORY.md.
agent: true
---

# Memorize — Background Memory Agent

Writes facts to two places only: **AGENTS.md** (non-obvious technical caveats) and **rs-learn** (all classified facts via fast ingest).

Resolve at start of every run:

- **Project root** = `process.cwd()` when invoked. `AGENTS.md` is `<project root>/AGENTS.md`.

## STEP 1: CLASSIFY

Examine the ## CONTEXT TO MEMORIZE section at the end of this prompt. For each fact, classify as:

- user: user role, goals, preferences, knowledge
- feedback: guidance on approach — corrections AND confirmations
- project: ongoing work, goals, bugs, incidents, decisions
- reference: pointers to external systems, URLs, paths

Discard:
- Obvious facts derivable from reading the code
- Active task state or session progress
- Facts that would not be useful in a future session

## STEP 2: INGEST INTO RS-LEARN

For each classified fact, invoke the plugkit memorize subcommand (prefers in-process HTTP to a running `rs-learn serve`, falls back to subprocess automatically — fast either way):

```bash
plugkit memorize --source "<type>/<slug>" "<fact text>"
```

Where `<fact text>` is a self-contained one-to-three sentence summary of the fact, and `<slug>` is a short kebab-case label (e.g. `feedback/terse-responses`, `project/merge-freeze`).

For multi-paragraph facts, prefer the file form to avoid argv length limits:

```bash
plugkit memorize --source "<type>/<slug>" --file <path>
```

## STEP 3: AGENTS.md

A non-obvious technical caveat qualifies if it required multiple failed runs to discover and would not be apparent from reading code or docs.

For each qualifying fact from context:
- Read AGENTS.md first if not already read this run
- If AGENTS.md already covers it → skip
- If genuinely non-obvious → append to the appropriate section

Never add: obvious patterns, active task progress, redundant restatements.
