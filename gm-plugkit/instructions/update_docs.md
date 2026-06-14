# UPDATE-DOCS

YOU are the state machine. Plugkit is the synchronous library serving this prose; docs do not update themselves -- you dispatch every edit and every push.

Docs reflect the current state of the system, not its history. Every rule in AGENTS.md is present-tense -- what must or must-not be the case in code now. Past-tense framing, `(FIXED)` markers, dated audit entries, and "we used to X, now Y" belong in `git log` and `CHANGELOG.md`, never AGENTS.md.

## AGENTS.md and CLAUDE.md

Edit AGENTS.md/CLAUDE.md inline -- the top of the preserved hierarchy and the only doc that survives context summarization. `memorize-fire` is the parallel surface (`.gm/exec-spool/in/memorize-fire/<N>.txt`, raw text or `{text, namespace?}`) where `recall`/`auto_recall` retrieve the fact on future turns. AGENTS.md is the staging ground; the store is the recall surface. Migration is the agent's dual-write, not a file-scan: landing a load-bearing rule in AGENTS.md, fire the same rule to the store the same session so it surfaces in `auto_recall`. An automatic ingest cannot run -- the classifier cannot judge which paragraphs are recall-worthy rules vs narrative, so the agent judges at write time. Never pass `namespace:"AGENTS.md"` (mislabeled namespace); load-bearing rules go to the default namespace. Multiple facts = multiple parallel requests in one message.

**Migration is bidirectional; the back-pressure is deflation -- every memorize run also drains AGENTS.md.** AGENTS.md grows monotonically if flow is only inward and bloats past the budget it protects. So every session firing `memorize-fire` for new facts ALSO picks a few existing AGENTS.md entries that have gone detail-heavy/single-crate/single-platform (the material the Documentation Policy assigns to rs-learn), `memorize-fire`s the substance to the default namespace, and deletes or compresses the paragraph to a one-line pointer in the same commit. Eligible = a per-crate runtime quirk, a Windows/process mechanic, a hook implementation detail, any fact-base caveat a future agent reaches for via `recall` rather than needing resident every prompt. Top-level cross-cutting rules stay; everything recall-reachable drains. Witnessed both ways: the fact lands in the store AND the byte-count drops. A few entries per run, never a wholesale rewrite. Skipping the drain is the slow-bloat drift the policy exists to prevent.

## README.md

Refresh to the surface a new reader actually encounters: remove every stale install step, version pin, and gone feature; add what you added this session if it changes the public surface.

## docs/index.html

Regenerate/hand-edit to the same surface. Site builds run from `site/`; the deployed `/` route renders from `site/content/pages/home.yaml` via flatspace. Route landing edits through `site/theme.mjs` (Hero) and the YAML, never `site/index.html` directly. `docs/styles.css` is generated from `site/input.css` -- append to the source, not the output.

## CHANGELOG.md

One entry per commit landed this session: the commit subject plus a one-sentence "why", no recipe. CHANGELOG carries the history AGENTS.md refuses.

## Commit and Push

Stage doc updates only -- never bundle them with code changes from earlier phases (committed at their own time). One commit, present-tense imperative subject. Push via the git verbs: `git_finalize {message}` bundles add -> commit -> porcelain-gate -> push in one dispatch, or `git_add` the doc paths then `git_commit` then `git_push`. The verbs gate on the porcelain probe internally and refuse a dirty tree (`deviation.push-dirty`); a raw `git` shell body is gated `deviation.bash-git-bypass`. If you ever fall back to raw Bash git, the porcelain probe must be its own `Bash(git status --porcelain)` tool-use event before the push (not `&&`-chained) -- ccsniff `--git-discipline` scans the last 20 Bash tool-use events for the porcelain regex, and `add && commit && push` in one event has no witness. A doc commit stages only paths matching AGENTS.md, CLAUDE.md, README.md, SKILLS.md, CHANGELOG.md, LICENSE*, docs/**, or site/**; any non-doc path means you bundled phases -- split it out before staging. The push triggers the docs pipeline and IS the validation dispatch.

## COMPLETE

Terminal phase. After the push lands, dispatch `transition` to COMPLETE; plugkit records the chain concluded.

**Once `phase=COMPLETE` and `prd_pending_count=0`, the chain is closed.** Do not re-dispatch `instruction` to "check" -- the response is the same UPDATE-DOCS prose, and the dispatch surface is closed; the session ends. A new user request resets phase to PLAN on the first instruction dispatch with a fresh prompt body. Re-dispatching instruction on a COMPLETE chain with no new prompt is a deviation (`turn.start`/`turn.end` pairs with `dispatches:1`, instruction-as-polling); the recovery is to stop dispatching -- the user reactivates the chain.

## Dispatch

`phase-status` to confirm chain state, then `transition` to COMPLETE if not already. After COMPLETE lands, stop.
