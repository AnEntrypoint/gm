# UPDATE-DOCS

YOU are the state machine. Plugkit is the synchronous library serving this prose; advancing the chain is your dispatch, not its action. Docs do not update themselves — you dispatch every possible edit and every possible push.

Your docs reflect the current state of the system, not its history. You write every possible rule in AGENTS.md as a present-tense statement about what must or must-not be the case in code now. Past-tense framing, `(FIXED)` markers, dated audit entries, and "we used to X, now we Y" phrasing belong in `git log` and `CHANGELOG.md` — you never put them in AGENTS.md.

## AGENTS.md and CLAUDE.md

You edit AGENTS.md and CLAUDE.md inline as the primary persistence surface, these files are the top of the preserved hierarchy and the only doc that survives context summarization. Edit the file directly with the rules you want present and future agents to follow. The `memorize-fire` verb is a parallel surface: it stores the fact body to rs-learn (`.gm/exec-spool/in/memorize-fire/<N>.txt` with raw text or JSON `{text, namespace?}`) where `recall` and `auto_recall` retrieve it on future turns.

AGENTS.md is the staging ground; the learning store is the recall surface. Migration between them is the agent's dual-write, not an automatic file-scan: when you land a load-bearing rule in AGENTS.md, you dispatch `memorize-fire` for the same rule in the same session so it surfaces in `auto_recall` on future turns. This is deliberate, not a gap, an automatic AGENTS.md-to-store ingest cannot run because the classifier cannot safely judge which prose paragraphs are recall-worthy rules versus narrative; the agent makes that judgment at write time. The two surfaces stay in sync because the same edit that writes the rule to AGENTS.md also fires it to the store. Do NOT pass `namespace:"AGENTS.md"`, that creates a mislabeled namespace; load-bearing rules go to the default namespace where `auto_recall` reads them. For multiple facts you write multiple parallel spool requests in one message.

**Migration is bidirectional, and the back-pressure is deflation: every memorization run also drains AGENTS.md.** AGENTS.md grows monotonically if the only flow is into it; left unchecked it bloats past the context budget it is supposed to protect. So every session that fires `memorize-fire` for new facts ALSO picks a few existing AGENTS.md entries that have become detail-heavy, single-crate, or single-platform — exactly the material the Documentation Policy says belongs in rs-learn, not in the top-level rule file — and exfiltrates them: `memorize-fire` the entry's substance to the default namespace, then delete or compress its AGENTS.md paragraph to a one-line pointer in the same commit. Pick the candidates by the same test the policy names: a paragraph is exfiltration-eligible when it is a per-crate runtime quirk, a Windows/process mechanic, a hook implementation detail, or any fact-base caveat that a future agent would reach for via `recall` rather than needing resident in every prompt. Top-level cross-cutting rules that govern gm-the-repo stay; everything reachable by recall drains. The exfiltration is witnessed the same way the write is: the fact lands in the store (recallable next turn) AND the AGENTS.md byte-count drops. A few entries per run, not a wholesale rewrite — steady deflation keeps AGENTS.md lean while the recall surface absorbs the detail. Skipping the drain on a memorization run is the slow-bloat drift the policy exists to prevent; the default on every memorize run is to also drain.

## README.md

You refresh README to reflect the surface a new reader actually encounters. You remove every possible stale install step, version pin, and feature that no longer exists. You add what you added this session if it changes the public surface.

## docs/index.html

You regenerate or hand-edit to reflect the same surface. Site builds run from `site/`; the deployed `/` route renders from `site/content/pages/home.yaml` via flatspace. You route landing edits through `site/theme.mjs` (Hero) and the YAML — never `site/index.html` directly. `docs/styles.css` is generated from `site/input.css`; you append to the source, not the output.

## CHANGELOG.md

You write one entry per every possible commit you landed this session. The commit message line plus a one-sentence "why" — no recipe, no narration. CHANGELOG carries the history that AGENTS.md refuses.

## Commit and Push

You stage doc updates only — you never bundle them with code changes from earlier phases (you committed those at their own time). One commit, present-tense imperative subject. Before every possible push, you dispatch `git status --porcelain` as its own Bash **tool-use event** — a separate `Bash(...)` invocation, not a `&&`-chained shell command within the push event. Read its output empty; non-empty = uncommitted residual that the push would orphan, and you commit or revert it first. The probe must be a separate tool event because ccsniff `--git-discipline` scans the last 20 Bash tool-use events (not shell commands within events) for the porcelain regex; `add && commit && push` in one Bash call counts as one event with no porcelain witness even when the chain itself produces a clean tree. The witness lives in the tool-call stream, not the shell stream. Then you push to main. Your push triggers the docs pipeline if the repo has one. A doc commit stages only paths matching AGENTS.md, CLAUDE.md, README.md, SKILLS.md, CHANGELOG.md, LICENSE*, docs/**, or site/** — every possible non-doc path in a doc commit is a sign you bundled phases and you split it back out before staging.

## COMPLETE

This is the terminal phase. After your push lands, you dispatch `transition` to COMPLETE. Plugkit then records the chain as concluded.

**Once `phase=COMPLETE` and `prd_pending_count=0`, the chain is closed.** You do not re-dispatch `instruction` to "check" status — there is nothing to check; the response will be the same UPDATE-DOCS prose you are reading now. You do not dispatch every possible other verb either — the dispatch surface is closed. The session ends. If the user gives you a new request, plugkit will reset the phase to PLAN on the first instruction dispatch with a fresh prompt body.

Re-dispatching instruction on a COMPLETE chain with no new prompt is a deviation: it burns cycles, accumulates `turn.start`/`turn.end` pairs with `dispatches:1`, and signals that the agent is treating instruction as a polling primitive. The recovery is to stop dispatching; the user reactivates the chain.

## Dispatch

You dispatch `phase-status` to confirm the chain state, then `transition` to COMPLETE if you have not already. After COMPLETE lands, you stop.

Transition: when you have committed and pushed docs → you dispatch `transition` to advance to COMPLETE. Chain done.
