# UPDATE-DOCS

YOU are the state machine. Plugkit is the synchronous library serving this prose; docs do not update themselves -- you dispatch every edit and every push.

Docs reflect the current state of the system, not its history. Every rule in AGENTS.md is present-tense -- what must or must-not be the case in code now. Past-tense framing, `(FIXED)` markers, dated audit entries, and "we used to X, now Y" belong in `git log` and `CHANGELOG.md`, never AGENTS.md.

## AGENTS.md and CLAUDE.md

Edit AGENTS.md/CLAUDE.md inline -- top of preserved hierarchy, only doc surviving context summarization. `memorize-fire` = parallel surface (`.gm/exec-spool/in/memorize-fire/<N>.txt`, raw text or `{text, namespace?}`) where `recall`/`auto_recall` retrieve the fact future turns. AGENTS.md = staging ground; store = recall surface. Migration = agent's dual-write, not file-scan: land a load-bearing rule in AGENTS.md -> fire same rule to store same session so it surfaces in `auto_recall`. No auto-ingest -- classifier can't judge recall-worthy-rule vs narrative, agent judges at write time. Never `namespace:"AGENTS.md"` (mislabeled); load-bearing rules -> default namespace. Multiple facts = multiple parallel requests, one message.

**Migration is bidirectional; back-pressure = deflation -- every memorize run also drains AGENTS.md.** Inward-only flow bloats past budget. So every `memorize-fire` session for new facts ALSO picks a few existing detail-heavy/single-crate/single-platform AGENTS.md entries (Documentation Policy's rs-learn material), fires the substance to default namespace, compresses the paragraph to a one-line pointer, same commit. Eligible = recall-reachable, not needed resident every prompt; resident = cross-cutting rule, drainable = fact-base caveat. Top-level rules stay; recall-reachable drains. Witness both ways: fact lands in store AND byte-count drops. Few entries/run, never wholesale rewrite. Skipping the drain = the slow-bloat drift this policy prevents.

## README.md

Refresh to the surface a new reader actually encounters: remove every stale install step, version pin, and gone feature; add what you added this session if it changes the public surface.

## docs/index.html

Regenerate/hand-edit to the same surface. Site builds run from `site/`; the deployed `/` route renders from `site/content/pages/home.yaml` via flatspace. Route landing edits through `site/theme.mjs` (Hero) and the YAML, never `site/index.html` directly. `docs/styles.css` is generated from `site/input.css` -- append to the source, not the output.

## CHANGELOG.md

One entry per commit landed this session: the commit subject plus a one-sentence "why", no recipe. CHANGELOG carries the history AGENTS.md refuses.

## Commit and Push

Stage doc updates only -- never bundle them with code changes from earlier phases (committed at their own time). One commit, present-tense imperative subject. Push via the git verbs: `git_finalize {message}` bundles add -> commit -> porcelain-gate -> push in one dispatch, or `git_add` the doc paths then `git_commit` then `git_push`. The verbs gate on the porcelain probe internally and refuse a dirty tree (`deviation.push-dirty`); a raw `git` shell body is gated `deviation.bash-git-bypass`. If you ever fall back to raw Bash git, the porcelain probe is its own `Bash(git status --porcelain)` event before the push, never `&&`-chained -- a chained `add && commit && push` carries no separable witness, so ccsniff `--git-discipline` sees an unwitnessed push. A doc commit stages only paths matching AGENTS.md, CLAUDE.md, README.md, SKILLS.md, CHANGELOG.md, LICENSE*, docs/**, or site/**; any non-doc path means you bundled phases -- split it out before staging. The push triggers the docs pipeline and IS the validation dispatch.

## COMPLETE

Terminal phase. After the push lands, dispatch `transition` to COMPLETE; plugkit records the chain concluded.

**Once `phase=COMPLETE` and `prd_pending_count=0`, the chain is closed to further `instruction`/`phase-status` polling -- it is NOT closed to the mandatory `gm-continue` handoff.** Do not re-dispatch `instruction` to "check" -- the response is the same UPDATE-DOCS prose, and re-polling that surface is a deviation (`turn.start`/`turn.end` pairs with `dispatches:1`, instruction-as-polling). But the calling agent's own harness (Claude Code, or any host driving the `gm` skill) still owes ONE more dispatch before the turn genuinely ends: `Skill(skill="gm-continue")`. That skill does its own independent remaining-work check and either reloads `gm` (real work found, or first confirming pass this session) or reports the loop closed (nothing found, already confirmed once). This is not an `instruction`/`phase-status` re-poll -- it is a different tool (`Skill`) doing a different job, and it is what actually makes "stop" mean stop instead of leaving the user to manually re-prompt "list remaining limitations" in a new session. A new user request resets phase to PLAN on the first instruction dispatch with a fresh prompt body regardless.

**A response with no further tool call after this point IS the conversation ending, permanently -- not a pause the user resumes.** Writing "Session N closes, ready to resume with /gm," listing architecture decisions made as a wrap-up, or any other closing/summary sentence as the last content of a response has the exact same effect as never continuing again: there is no future turn where this same chain picks back up on its own. The only way "done" actually produces a next action instead of silence is dispatching `Skill(skill="gm-continue")` as the literal last thing in this same response -- not next time, not after the summary, in place of the summary.

## Dispatch

`phase-status` to confirm chain state, then `transition` to COMPLETE if not already. After COMPLETE lands, dispatch `Skill(skill="gm-continue")` -- that is the actual stop condition, not the bare `transition` response.
