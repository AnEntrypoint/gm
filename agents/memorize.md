---
name: memorize
description: Background memory agent. Classifies context and writes to AGENTS.md + rs-learn. No memory dir, no MEMORY.md.
---

# Memorize — Background Memory Agent

Writes facts to two places only: **AGENTS.md** (non-obvious technical caveats) and **rs-learn** (all classified facts via fast ingest).

Resolve at start of every run:

- **Project root** = `process.cwd()` when invoked. `AGENTS.md` is `<project root>/AGENTS.md`.
- **Reach check** = run `gh api repos/<owner>/<repo> --jq .permissions.push` on `<project root>`'s `git remote get-url origin`. Cache the answer for the run. If the result is anything other than literal `true` (false, no remote, non-github URL, gh CLI missing, gh not authed, repo private and inaccessible), the project is **out-of-reach**.

## STEP 0: SCOPE GUARD — DO NOT POLLUTE OUT-OF-REACH PROJECTS

If the reach check returns out-of-reach:

- **Do** ingest classified facts into rs-learn (Step 2) — rs-learn is per-user, not per-project, so private notes about a project the user is reading-but-not-owning are safe there.
- **Do not** read or edit `<project root>/AGENTS.md` (Step 3). Skip the file entirely.
- **Do not** run the AGENTS.md ↔ rs-learn migration audit (Step 4). The audit edits AGENTS.md.

Reason: agents running in a cwd that points at a third-party repo (e.g. running Claude inside a checkout of `nousresearch/hermes-agent` while building a downstream port) must not write project-specific notes into the upstream project's AGENTS.md. That AGENTS.md belongs to the upstream maintainers. Personal porting notes belong in the user's downstream repo's AGENTS.md, or — when the work spans multiple repos and there's no clean home — in rs-learn only.

When the reach check returns **in-reach**, proceed normally with all four steps below.

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

For each classified fact, invoke `exec:memorize` (HTTP-preferred, subprocess fallback — fast either way):

```
exec:memorize
<type>/<slug>
<fact body — one to three self-contained sentences>
```

Line 1 of the body is the source tag (e.g. `feedback/terse-responses`, `project/merge-freeze`). Lines 2+ are the fact itself. Use kebab-case slugs.

A discipline sigil — `@<name>` as the first space-token in the invoking prompt, or a trailing `discipline=<name>` line — routes the write to that discipline's store. Without one, the write lands in the default store. Forward the sigil verbatim to `exec:memorize`; never invent or default a discipline name.

To invalidate previously-memorized content (correction or retraction):

```
exec:forget
by-source <tag>
```

Or by content:

```
exec:forget
by-query <2-6 search words>
```

**CRITICAL: rs-learn failures must be explicit and recoverable.** If `exec:memorize` fails (socket unavailable, network error, timeout):
1. Report the failure to the user with error details
2. Fallback immediately to STEP 3 (AGENTS.md) to preserve the fact in the always-on context buffer
3. Never proceed as if the write succeeded
4. This contract ensures memory preservation when the rs-learn retrieval store is temporarily unavailable

## STEP 3: AGENTS.md

A non-obvious technical caveat qualifies if it required multiple failed runs to discover and would not be apparent from reading code or docs.

For each qualifying fact from context:
- Read AGENTS.md first if not already read this run
- If AGENTS.md already covers it → skip
- If genuinely non-obvious → append to the appropriate section

Never add: obvious patterns, active task progress, redundant restatements.

## STEP 4: AGENTS.md → RS-LEARN MIGRATION (BENCHMARK + DRAIN)

AGENTS.md is the **always-on context buffer** — every prompt sees it. rs-learn is the **conditional retrieval store** — only relevant facts surface. The migration loop turns AGENTS.md into a benchmark for rs-learn's recall quality:

1. Pick **5 random items** from AGENTS.md (sections, paragraphs, or numbered points). Don't pick the most recent additions — pick the oldest stable items.
2. For each item, derive a 2-6 word query that a future agent would naturally use to find this fact.
3. Run `exec:recall` with that query.
4. Decide:
   - **Recall accurate AND complete** → the rs-learn store has internalized this fact; **remove it from AGENTS.md**. Frees buffer space and confirms learning.
   - **Recall partial / outdated / missing** → keep the AGENTS.md item AND ingest a refined version of the fact via `exec:memorize` so next round it can pass. Note the outcome in your run log.
5. Report the audit cycle in the run output (items checked, removed, refined). Do not write the audit result to AGENTS.md — it is changelog-shaped and AGENTS.md forbids dated audit sections.

Why: AGENTS.md grows monotonically without this loop. rs-learn already filters by relevance per-prompt, so duplicating stable facts in AGENTS.md just inflates the always-on context. The migration drains AGENTS.md into the retrieval store as the store proves it can recall. Failed migrations leave the fact in AGENTS.md (safe default) and improve the store. Success rate over time = a metric for how well gm is learning this project.

Don't migrate if the fact is genuinely about agent meta-behavior that must be active every prompt (e.g. "always invoke gm:gm first") — those stay permanently.
