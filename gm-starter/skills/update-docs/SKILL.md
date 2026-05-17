---
name: update-docs
description: UPDATE-DOCS phase. Refresh README.md, AGENTS.md, and docs/index.html to reflect changes made this session. Commits and pushes doc updates. Terminal phase — declares COMPLETE.
allowed-tools: Skill, Read, Write
---

# update-docs — UPDATE-DOCS

Docs reflect the current state of the system, not its history. Every rule in AGENTS.md is a present-tense statement about what must or must-not be the case in code now. Past-tense framing, `(FIXED)` markers, dated audit entries, and "we used to X, now we Y" phrasing belong in `git log` and `CHANGELOG.md` — never in AGENTS.md.

## AGENTS.md and CLAUDE.md

Edits to AGENTS.md and CLAUDE.md route through the memorize subagent only — never inline-edit. Invocation:

```
Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')
```

The classifier rejects changelog-shaped facts from AGENTS.md ingestion (rs-learn still accepts them). Multiple facts → multiple parallel Agent calls in one message.

## README.md

Refresh to reflect the surface a new reader actually encounters. Remove stale install steps, version pins, and features that no longer exist. Add what was added this session if it changes the public surface.

## docs/index.html

Regenerate or hand-edit to reflect the same surface. Site builds run from `site/`; the deployed `/` route renders from `site/content/pages/home.yaml` via flatspace. Landing edits go through `site/theme.mjs` (Hero) and the YAML — never `site/index.html` directly. `docs/styles.css` is generated from `site/input.css`; append to the source, not the output.

## CHANGELOG.md

One entry per commit landed this session. The commit message line plus a one-sentence "why" — no recipe, no narration. CHANGELOG carries the history that AGENTS.md refuses.

## Commit and Push

Stage doc updates only — never bundle them with code changes from earlier phases (those committed at their own time). One commit, present-tense imperative subject. Push to main. The push triggers the docs pipeline if the repo has one.

## COMPLETE

This is the terminal phase. After push lands, the chain signals COMPLETE. No further `Skill()` invocation; the orchestrator records the chain as concluded.

## Dispatch

`phase-status`, `transition` to COMPLETE.

## Transition

`nextSkill: null` from the orchestrator means the chain is done. End of skill body.
