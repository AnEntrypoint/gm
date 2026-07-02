# AGENTS.md

--JULES STOPGAP DONT EDIT START--

## Skills

This project has task-specific skills available.

> **MANDATORY:** Before writing every possible piece of code, creating every possible file, or running every possible command,
> you **MUST** first read `SKILLS.md` and check for relevant skills.
> This step is **non-negotiable** and applies to **every possible task** without exception.

**Steps to follow before every possible task:**
1. `view SKILLS.md`, discover every possible available skill
2. `view` every possible skill file that is plausibly relevant to the task
3. Only then proceed with the task

Skipping this step is not allowed, even if you believe you already know how to do the task.
Skills encode environment-specific constraints that override general knowledge.

--JULES STOPGAP DONT EDIT STOP--

# Architecture & Philosophy

Repo root = package root = published `gm-skill` npm package; no factory, no separate build-output dir. Entry: `skills/gm/SKILL.md`. Orchestration lives in rs-plugkit, served on-demand via `instruction`. Agent-facing prose (phase instruction, gate/residual text) externalizes to editable `gm-plugkit/instructions/`: prose edits = gm-plugkit republish, zero Rust rebuild. Mechanism (prose.rs per-key fallback to compiled const; sync-instruction-consts.mjs byte-aligns .md<->rs-plugkit consts) in rs-learn (`recall: string-externalization project`).

## WASM-only

Plugkit = wasm cdylib, loaded by `plugkit-wasm-wrapper.js` under Node/bun; zero native binaries built/downloaded/published. `plugkit.wasm` fetched at bootstrap from `plugkit-wasm` npm / `plugkit-bin` gh-releases, sha256-pinned. Size + embedded-model (offline in-wasm embeddings) mechanics: rs-learn (`recall: WASM-only plugkit size mechanics`).

Wasm host-import link-module rule (`#[link(wasm_import_module="env")]` on every host-import extern block, every dep crate): rs-learn (`recall: wasm host-import link-module trap`).

**`plugkit-wasm-wrapper.js` is ESM; import node builtins at module scope, never inline `require()`** (rs-learn: `recall: wrapper require not defined under bun`).

**Every single-instance/lock guard is atomic** (O_EXCL / atomic-rename), never check-then-act (rs-learn: `recall: supervisor churn TOCTOU atomic guard`).

## Spool dispatch ABI

Dispatch = Write `.gm/exec-spool/in/<verb>/<N>.txt`, Read `.gm/exec-spool/out/<verb>-<N>.json` (nested) or `out/<N>.json` (root). Wasm orchestrator services every verb; harness never executes side effects directly.

- **Orchestrator verbs**: `instruction`, `transition`, `phase-status`, `mutable-resolve`, `memorize-fire`, `residual-scan`, `auto-recall`.
- **Wasm-direct verbs**: fs/kv/exec/fetch/env, recall, codesearch, memorize(+prune), health, filter, full git verb family. Enumeration in rs-learn (`recall: wasm-direct plugkit verbs full list`).
- **memorize-prune**: prune bad/superseded memories; two-mode spec (key-delete vs query-review) in rs-learn (`recall: memorize-prune verb two-mode spec`).
- **git verbs**: git is a first-class spool surface, never a shell command; `git_finalize {message}` is the bundled COMPLETE-phase push surface, `git_push` the only admissible raw push (porcelain-gated, rebase-retry). A git-dominant `bash`/`powershell` body is gated (`deviation.bash-git-bypass`). Per-verb shapes + host_git `.exe` resolution in rs-learn (`recall: git verbs rs-plugkit spool surface`).
- **filter**: pure stdout -> compact-stdout transform, in-wasm. Spec + usage (pipe raw command output through it before context) in rs-learn (`recall: filter verb rs-plugkit spool spec`).

## Documentation Policy

Record only non-obvious multi-run-cost caveats; prune stale; never document the code-obvious.

**No changelog history in AGENTS.md.** Every entry is a present-tense rule about what must/must-not be the case in code now. Forbidden: `(FIXED)` markers, commit hashes, dated audit entries, `## Learning audit` sections, "(added 2026-...)" annotations, "we used to X, now Y". History belongs in `git log` and `CHANGELOG.md`.

**Detail-heavy caveats live in rs-learn (`.gm/rs-learn.db`), not here.** Per-crate/OS/hook/workflow fact-base -> rs-learn (`exec:recall`); AGENTS.md keeps top-level gm-repo-governing rules only. Cross-cutting policy stays; single-crate/single-platform mechanism drains.

**gm's recall store (`.gm/rs-learn.db` default namespace) holds gm/rs-* method/tooling/invariants ONLY -- never target-project specifics.** A finding ABOUT a project gm merely drives ON (its paths, line numbers, `.gm/prd.yml`/`mutables.yml` contents, app internals, versions) belongs in THAT project's own `.gm` store -- pollutes every gm session's recall otherwise. Using gm != working on the driven project: scrub names/paths/state, keep only the generalizable gm-method lesson. Binds `mutable-resolve`/`prd-resolve` auto-memo too -- witness in gm-method terms, never by quoting foreign tree. (Code-side classifier reject rejected as too brittle -- false-rejects legit `.gm/prd.yml` mechanism citations -- so discipline + on-sight `memorize-prune` of foreign-specific memos is the enforcement.)

**Every memorize run also drains AGENTS.md -- bidirectional migration, deflation is the back-pressure.** Inward-only flow bloats past budget: every `memorize-fire` session ALSO exfiltrates a few detail-heavy/single-crate/single-platform entries -- fire substance to default namespace, compress paragraph to one-line pointer, same commit. Witness: store gains fact, byte-count drops. Few per run, never wholesale; top-level rules stay, recall-reachable detail drains. `test.js checkAgentsMdBudget()` = structural byte-ceiling backstop (`recall: AGENTS.md byte-ceiling guard looper bloat`).

## Coding Style

**No synthetic/unit test files, ever -- manual legwork through real code execution is the only test surface.** No `*.test.*`/`*.spec.*` files, no `test/`/`__tests__/`/`spec/` directories, no jest/mocha/vitest/pytest/unittest/junit or any assertion/mocking library, in this repo or any repo gm drives work in. Verification is running the real thing and reading the real output -- `exec_js`/`browser` witnessing a live invariant, or an addition to the single root `test.js` (<=200 lines, real services, mock-free, defined in `skills/gm/SKILL.md`). A PRD row for "add validation"/"handle edge case X" is closed by exercising that case live, never by authoring a test case that exercises it later. Rationale + measured impact on coder throughput: rs-learn (`recall: synthetic-test-file coder-performance regression`). Full phase-level enforcement (PLAN's edge-case rows, EXECUTE's hard rule, VERIFY's `deviation.synthetic-test-file` gate) lives in rs-plugkit's served `instruction` prose, not duplicated here.

**No comments in code** -- no inline, block, or JSDoc comments anywhere (source, generated output, hooks, scripts). `test.js checkNoComments()` is the structural guard (fails on any leading `//` over tracked `.js/.mjs/.cjs`); one sighting spawns the full-tree sweep.

**No UTF-8 BOM in any tracked source file** -- always `-Encoding utf8` (no BOM) or the `Write` tool; PowerShell defaults betray this. `test.js checkNoBom()` is the structural guard; one sighting spawns the full-tree sweep. Cause + breakage mechanics in rs-learn (`recall: BOM regression incident`).

**No graphical symbols; convert to industry-standard text on sight.** Any non-ASCII decorative glyph (arrows, box/geometric glyphs, stars, dots, bullets, checks/crosses, emojis) is forbidden in all output and source -- convert it to its plain-ASCII equivalent the same turn (the word, `->`, `-`/`*`, `[x]`/`[ ]`, done/todo/pass/fail). Tell-tale-AI class: one sighting spawns the full-codebase sweep, never a one-off edit. Exempt: functional code operators (`=>`, `??`, `?.`, comparison/math), frozen changelog/git-log entries, binary stores, intentional icon-font/CSS-content product glyphs, and canonical CS/formal-logic notation in `.gm/constraints.md` / `gm-plugkit/constraints-default.md` (`.`, `->` as function-space, `|-`, set/quantifier symbols) -- these are semantic operators in a formal constraints spec, not decorative flourish. `ccsniff --glyph-discipline` flags decorative glyphs post-hoc (run each audit, like `--git-discipline`/`--search-discipline`).

**Skill SKILL.md files:** strip explanatory prose; keep ONLY invocation syntax, transition markers (`->`), gate conditions, constraint lists, exact-usage code examples.

**Implicit, not explicit, in skill prose.** Skill files (and prompt-submit.txt) elicit, never describe: terse imperatives triggering already-learned dispositions, not numbered procedures. Describes = agent could re-derive from the goal (recipe, do-X-then-Y, trigger-instance list, over-explained rationale, restated mechanism) -- convert. Elicits = constructs a predicament where the wrong move is structurally incoherent -- keep. Exception: boot-edge ABI (exact spool paths, JSON fields, verb names, globs, deviation ids, gate names) is non-derivable, stays explicit regardless. Forbidden: step-by-step recipes, "see paper section X", site/paper citations, multi-step manuals -- manual-shaped skill gets imitated as script, breaks at first edge case. Papers/site are discipline OUTPUTS, never link from a skill into docs. Cross-cutting rules needing citation belong here, not in skills.

## Build

No build step; repo root = published artifact. `npm publish` from root ships `gm-skill` (permanent npm id; skill DIR is `skills/gm`, command is `/gm`). `package.json` `files:` pins shipped paths. `AnEntrypoint/gm-skill` = back-compat mirror, receives only `skills/gm/SKILL.md` per release.

`bin/install.js` = canonical installer (no npx `skills` lib, no marketplace); landed dir name IS the `/command`; `test.js checkRenameAndInstaller()` = structural guard. Copy-target, four non-interactive Claude Code settings, reasoning-in-code framing, guard assertions: rs-learn (`recall: gm installer detail`).

## The agent is the orchestrator; plugkit is the brain it drives

Plugkit = stateful library the agent drives by verb dispatch -- never autonomous, never background-advances phases, never validates while agent waits. State change = verb written to `.gm/exec-spool/in/<verb>/<N>.txt`; dispatch ledger is ground truth, so zero-dispatch narrated PLAN->COMPLETE = fabricated. PLAN -> EXECUTE -> EMIT -> VERIFY -> CONSOLIDATE -> COMPLETE lives natively in rs-plugkit (phase/mutables/memorize/transition-legality as data + gate checks); agent triggers every op, plugkit synchronous from agent's view -- polling output dir instead of reading response = canonical misuse. CONSOLIDATE owns git-push + CI/CD validation, split off COMPLETE gate so COMPLETE checks only the consolidated result. File paths + verb enumeration: rs-learn (`recall: rs-plugkit state-machine internals`).

## gm is the canonical universal harness

`skills/gm/SKILL.md` = single source of truth; one skill shipped, legacy 15-platform fanout retired. Install: `bun x skills add AnEntrypoint/gm`. Detail: rs-learn (`recall: legacy gm-skill variants retired`).

## Tool surface is plugkit-only

Every skill's `allowed-tools:` reduced to `Skill, Read, Write` (plus SKILL.md boot `Bash(bun *)`/`Bash(npx *)`); `Write` exclusively for spool dispatch. Every other side effect -- exec, git, browser, recall, memorize, codesearch -- routes spool -> plugkit. Never reach around plugkit; missing capability = new plugkit verb, not skill-side tool.

## Core Rules

**Shared memory & search index are tracked, never ignored**: `.gm/rs-learn.db`, `.gm/code-search/` committed -- state shares cross-machine/session/CI. Never gitignore `.gm/`, `.gm/rs-learn.db`, `.gm/code-search/`, legacy `.code-search/`; transient `.gm/*` entries listed one-by-one between managed markers (parent-re-include caveat). Entry list + `ensureGitignored` mechanics: rs-learn (`recall: gm managed-gitignore mechanics`). Project-local persistent state -> `.gm/<name>/`, never top-level dotfile/dotdir.

**Disciplines are isolated knowledge stores**: per-project `<project>/.gm/disciplines/<name>/{rs-learn.db, code-search/}`, own DB+index each. `@<name>` sigil = strict isolation (cross-discipline reads forbidden). Sigil-less reads (recall/codesearch) fan across `default` + every `enabled.txt` line, merge-ranked `[discipline:<name>]`-prefixed; sigil-less writes -> `default` only. Tracked, never ignored (`ensureGitignored` excludes `.gm/disciplines`). Harness + every spool verb propagate `@<name>` verbatim.

**Nothing fake in source the user runs**: stub/mock/placeholder-return/fixture-only-path/demo-mode-short-circuit/"TODO: implement" forbidden in shipped code. Scaffolds/shims permitted only delegating to real behavior (upstream API, subprocess, disk); check for an existing library before adding a shim. Detection = behavioral: always-succeeds, input-invariant, or type-signature-satisfying short-circuit = stub. Acceptance = real input through real code into real output, witnessed.

**Spool dispatch gates**: denials surface reason as imperative instruction, never mutate args. Implementation + marker semantics: rs-learn (`recall: spool dispatch gates marker files`).

**Done is plugkit's pronouncement, never the agent's claim**: COMPLETE only when `transition to=COMPLETE` returns COMPLETE phase, on-disk state reflects it. COMPLETE gate (gates.rs) = sole arbiter -- refuses on PRD-open, mutables-unresolved, dirty worktree, missing residual-scan marker. Agent drives into gate-allowing state, dispatches, reads response; every alternative is narration.

**Every residual is triaged this turn, never named-and-deferred**: every `git status --porcelain` entry at residual-scan/COMPLETE-attempt triaged now -- (a) commit (real work), (b) managed-gitignore-block (transient runtime emission, e.g. `.gm/witness/`, `.gm/exec-spool/.*-stale.json`), (c) revert (junk). "Pre-existing" = the (a)/(c) outcome, never a stop excuse. `blockedBy: external` admissible only when triage needs unreachable authority; local-tree files always agent-authoritative. Disciplines + new memorize-fire `mem-*.json` committed. Managed block (`# >>> plugkit managed` markers) carries only zero-future-read-value runtime artifacts.

**"Every possible" is the load-bearing test, applied to every noun the request names**: PLAN-phase PRD = exhaustive, not minimal -- "every possible" task/validation/mutable/corner-case/caveat/failure-mode/interaction/empty-overflow-reentry/degenerate-input -> rows. Single-digit PRD on non-trivial request = enumeration unfinished. Second-pass transform: each row's every-possible-corner-case -> new rows; close only when the transform yields nothing new. Validations/edge-cases/anticipated-mutables = first-class rows. High-tens-to-hundreds is the expected long-horizon shape -- row count IS the cover's resolution. Sparse PRDs orphan work; dense PRDs make completion observable.

**Every possible aspect checkable for jank is a PRD row; architecture is pliable**: at PLAN, every prompt-concerned surface -> enumerate every `jank` (immaturity/unfinished-edge/half-wired-path) across gui/ux/ui/client-state/server-state/boundary + reached surfaces, each its own row plus a per-surface profiling row and security row. `jank` = rough/unpolished/almost-done, not just bugs. Scoped to prompt's reachable closure, exhaustive within it. Every found issue spawns its own debug-repair plan same turn; every quick win spooled too. `pliable`: architectural change clearly reducing maintenance burden = spooled plan -- swap bespoke code for native/well-maintained-library ONLY when it nets a SMALLER maintained surface (heavy dep for a few lines = guarded failure mode). Fan-out = spool-native (parallel `prd-add`/`codesearch`/`exec_js`, plugkit task-spawn), never platform Task/Explore. One AI-tell design element (boilerplate flourish, over-hedged comment, generic scaffold name) spawns full-codebase sweep -- scan/per-cluster/fix-verify rows, exhaustive, never one-off.

**Client-side debugging exposes globals and evaluates in-browser, never blind-restarts**: live page = the debugger (rs-learn: `recall: client-side-debug-globals-live-page`).

**Mundane user-facing output is suppressed or stripped to the bone**: drop articles/preamble/play-by-play/boot-probe narration/dispatch echoes/restated-prose/status recaps. Survives: real finding, decision+one-line-reason, blocker, single-line PRD-read declaration. Terse = fewer words, NEVER zero tool calls, never silent work -- turn still ends chain-advancing.

**Noticing is a planning event, at every phase, in every dispatch window**: any observation (outstanding/unfinished/improvable/preference-misaligned/adjacent-surface) -> `prd-add` this turn. Response-body-only observations evaporate; only PRD store survives. Density grows along the walk, not just PLAN -- exiting PLAN with N rows and reaching COMPLETE with N rows = lost discoveries. Structural noticing (missing coverage/docs, rule-violating commit) and preference-aware noticing (drift from dense-PRDs/residual-triage/no-defer/every-possible/browser-witness/push-on-clean) each -> a row with its witness.

**A turn without a tool call is a stop; summary is a stop; both forbidden until plugkit pronounces COMPLETE**: agents read only tool calls+outputs, so prose-only ends the turn -- mechanical root of "did one piece and stopped." Deferred intent = same stop facing forward (naming the next move instead of taking it strands the chain). Absolute, tool-agnostic: in-flight (phase!=COMPLETE OR prd_pending_count>0) -> every turn ends in chain-advancing dispatch (`instruction`, next verb, `transition`, `phase-status`). Decisions surface via `AskUserQuestion`/`prd-add`, never prose. Only `phase=COMPLETE AND prd_pending_count=0` authorizes prose-only; "feels done" authorizes nothing. Apparent stop -> dispatch `phase-status`, recheck.

**Always seek the next state transition**: not-COMPLETE = next move exists; idle mid-chain = deviation. `phase-status` = where; `instruction` = what's next. No "wait for user" mid-chain -- closure was authorized at request time.

**Return to plugkit on every possible drift**: `instruction` = sole recovery primitive -- stall/gate-denial/error/uncertainty -> dispatch, read, never improvise. Synchronous, cheap, idempotent; over-dispatch free, under-dispatch = canonical drift. Gate denial names next verb in `reason`; dispatch that, never argue around it.

**Push is part of COMPLETE, never optional, never asked**: tracked-file-mutating session ends commit+push to origin. "Want me to push?" = deviation -- push IS the validation dispatch (`verify.rs`). Not-COMPLETE until remote reflects HEAD. ccsniff `--git-discipline` + `deviation.complete-without-push` flag unpushed closes.

**Direct-push to main, never a branch, never a PR**: every gm/rs-* change -> straight `main` commit+push; git verbs (`git_finalize`/`git_push`) already target `main`, cascade ships from `main`. Branch/PR/fork = deviation, no review-gate exists. Sibling repo with open PR: merge to `main`, push, delete branch. Only admissible remote refs: `main`, `gh-pages` -- `git_push {repo, branch:"main"}` for siblings too.

**Push requires clean worktree witnessed in its own tool-use event**: `git push` only on empty `git status --porcelain`, probed its OWN Bash event before push (never `&&`-chained). Prefer `git_push`/`git_finalize` (internal gate). Enforcement locations: rs-learn (`recall: push clean worktree enforcement locations`).

**AGENTS.md / CLAUDE.md are inline-edited AND dual-written to the store**: inline-edit for structural rules (only doc surviving context summarization), AND `memorize-fire` the same rule for `recall`/`auto_recall` surfacing -- complementary, not either/or. Never `namespace:"AGENTS.md"`; load-bearing rules -> default namespace. Mechanics: rs-learn (`recall: memorize-fire ingestion classifier`).

**A memorized workaround is a tool defect; transform it, never accumulate it**: using gm != working on gm, so a workaround/known-limitation-framed `recall` memo is tribal knowledge that surprises a fresh user/LLM -- surprises forbidden, everything must be predictable at face value. Resolve: (a) already in standing prose -> prune; (b) prose-worthy, absent -> add then prune; (c) genuinely surprising -> fix code predictable then prune.

**Behavioral discipline lives in plugkit's `instruction` verb**: dispatch `instruction` for live phase-specific prose (Three-Layer Admission Filter, maturity-first emit, closure anti-shapes, code invariants); not duplicated here. Enumeration: rs-learn (`recall: instruction-verb behavioral discipline invariants`).

**The agent IS the LLM rs-learn calls**: no separate judge model; decisions inline via spool. Internals: rs-learn (`recall: rs-learn self-report core internals`).

**Idempotency contract (f∘f≡f)**: spool dispatch = at-least-once by design (in-memory processed-Map guards only concurrent double-pickup, not cross-time replay/restart), so correctness rests on per-verb convergence: `memorize`/`memorize-fire` content-hash-key+dedup, `git_finalize`/`git_commit` nothing-to-commit/already-pushed, `insert_edge` kv-overwrite-by-id+dedup-guarded-index, `invalidate_edge` early-return, `ensure_managed_gitignore` strip-rebuild-changed-gate, codeinsight digest-gate, publish.yml already-published-skip+porcelain-gated-version-commit-back. Read-only verbs (recall/codesearch/git_status/instruction/health/filter) recompute every dispatch, never cache. `exec_js`/`browser` re-run on replay (at-most-once-by-nature); persistent dedup ledger rejected as net-additive. Detail: rs-learn (`recall: idempotency contract per-verb convergence`).

**host_exec_js is synchronous**: real per-call `timeoutMs` required (zero/missing = hard error). Detail: rs-learn (`recall: host_exec_js synchronous`).

**Sync-before-emit (codeinsight + search)**: output must come from this-invocation freshly-synced index (cache serves only on digest match). Mechanics: rs-learn (`recall: sync-before-emit codeinsight search`).

**Auto-recall on turn entry**: `instruction` attaches `auto_recall` pack on first dispatch after >30s idle gap / session-start. Detail: rs-learn (`recall: auto-recall on turn entry`).

**Skill SKILL.md frontmatter `allowed-tools:` is harness-enforced**: must list `Skill` (+`Read`/`Write`, Write only for spool dispatch) or loses downstream-skill invocation that turn. Detail: rs-learn (`recall: SKILL.md frontmatter allowed-tools`).

**rs-learn observability**: pipeline state changes emit `evt:` lines to `.gm/exec-spool/.watcher.log` + gm-log; recall replies carry per-hit scoring fields. Taxonomy: rs-learn (`recall: rs-learn observability taxonomy`).

**Bootstrap contract**: `ensureReady` inits wasm hook-free, sha256-rewrites stale installed SKILL.md, seeds per-project `CLAUDE.md`/`.gm/next-step.md`. Detail: rs-learn (`recall: skill-initiated bootstrap contract`, `recall: SKILL.md auto-refresh`).

## Cascade pipeline

Push to any rs-* sibling -> `cascade.yml` -> rs-plugkit `release.yml` -> single `plugkit.wasm` (npm `plugkit-wasm` + `plugkit-bin` Releases) -> auto-bump `gm.json::plugkitVersion` -> `publish.yml` ships gm-skill+gm-plugkit+SKILL.md mirror. Step sequence + PUBLISHER_TOKEN: rs-learn (`recall: cascade pipeline`).

**Repos involved (push to any triggers cascade):** `AnEntrypoint/{rs-exec, rs-codeinsight, rs-search, rs-plugkit, rs-learn, gm}` -- rs-plugkit Cargo.toml = version source-of-truth, gm.json holds plugkitVersion. Three npm packages ship: `gm-skill`, `gm-plugkit`, `plugkit-wasm`. Per-repo roles + legacy-retirement: rs-learn (`recall: cascade repos involved roles`, `recall: legacy gm-skill variants retired`).

**To update every possible thing**: push to the relevant repo. No manual version bumps, no local `cargo update`/`cargo build` -- push, let CI build.

## Spool-dispatch architecture replaces hooks

Orchestration state tracked via `.gm/` marker files, not hook events; CLI's `checkDispatchGates()` gates Write/Edit/git pre-execution. Marker set (`prd.yml, mutables.yml, needs-gm, gm-fired-<sessionId>, residual-check-fired`) + SpoolDispatcher mechanism: rs-learn (`recall: gate enforcement layer`, `recall: spool dispatch gates marker files`).

**gm tool-use sequencing**: `Skill(skill="gm")` clears needs-gm gate. One shipped skill, no subagent variant. Marker mechanics: rs-learn (`recall: gm-skill tool-use sequencing mechanics`).

**The skill is the driver, not a post-hoc witness**: standing instruction to use gm skill (every `/loop` fire, any `/gm` prompt) -> FIRST action is `Skill(skill="gm")`, skill prose drives PLAN->COMPLETE. Direct spool verbs without entering the skill first = work executed outside the requested driver; end-only entry to confirm terminal state does NOT satisfy the instruction. Boot probe (`cat .gm/exec-spool/.status.json` ...) may precede invocation; every state mutation happens inside the skill-driven session.

**Dead-watcher recovery uses `bun x gm-plugkit@latest spool`, never direct-node boot** (mechanism: rs-learn `recall: dead-watcher recovery bun x not direct-node`).

**Starting the spool is one atomic blocking call -- `bun x gm-plugkit@latest spool` daemonizes the watcher AND blocks until `.status.json` heartbeats fresh, returning exit 0 only when serving (loud non-zero on timeout).** No `& + sleep + re-cat` dance; agent writes to `instruction/` the moment the call returns. Wait lives in `gm-plugkit/cli.js` (`waitForWatcherHeartbeat`, `Atomics.wait` sync-sleep), cli-side since `startSpoolDaemon` is sync + shared by non-blocking callers. rs-plugkit carries no server-boot logic -- daemonize lifecycle is entirely gm-plugkit JS, no Rust/cascade rebuild needed.

**Apparent tooling failure is mechanical self-recovery, NEVER a question for the user and never an a/b-test/blind-restart.** Missing spool response / stale watcher = agent's own job: honor future `busy_until` else boot+re-dispatch -- spooler is sound by construction, asking the user to do what a verb can do is a paper-spirit violation. Recovery mechanics (atomic `.status.json`, `FailedToOpenSocket` retry, debug-via-`window.*`-globals): rs-learn (`recall: spooler self-recovery mechanics`).

**Process-of-elimination is the debugging paradigm EVERYWHERE, and manual real-services witness is the verification paradigm EVERYWHERE** -- both stated in `instructions/execute.md` (served EXECUTE prose). Detail: rs-learn (`recall: process-of-elimination manual-real-services-witness paradigm`).

**The first verb after a genuine multi-minute IDLE is `instruction`, to reset the long-gap clock**: only spool verbs reset it, so long platform-tool investigation trips false stall -- interleave `instruction`/`prd-add` to stay warm, dispatch `instruction` BEFORE any predictable blocking wait. Threshold + exception: rs-learn (`recall: first verb after multi-minute wait instruction long-gap`).

**A stop-hook firing on a terminal chain does not authorize re-polling**: stop-hook at `phase=COMPLETE AND prd_pending_count=0` -> re-dispatching `instruction`/`phase-status` to "re-confirm" = deviation (`deviation.complete-chain-poll`, `instructions/mod.rs`). Two admissible responses: (a) prose-only turn (COMPLETE in hand), (b) genuinely new work via FRESH `{"prompt":...}` body (resets to PLAN, skill-driven). Repeated same-hook answering = loop; state terminal facts once and stop, or open new work.

Session lifecycle (task/browser persistence across turn-stops, residual-scan trigger conditions): rs-learn (`recall: session lifecycle killSessionTasks residual-scan`).

Browser session state roots at the git common dir, never `process.cwd()` (worktree fan-out shares one chromium, not N): rs-learn (`recall: browser session state worktree common-dir rooting`).

**Per-project `.gm/constraints.md` is the standing decision arbiter**: seed-if-absent (bootstrap copies the bundled CS-constraints default only when missing), never overwrite on re-seed -- it is user-editable mutable config, same contract as `.gm/next-step.md`. Every design/code decision the agent makes gauges against it; the pointer rule lives in SKILL.md, this is only the existence/mechanism note. `test.js` witnesses both the seed and the no-clobber idempotency.

## Spool observability surface

One-shot system-state probe: dispatch `plugkit health` before assuming any component broken; runtime diagnostic files at `.gm/exec-spool/` root readable directly via Read (runtime-data exception). File list + health fields: rs-learn (`recall: spool runtime diagnostic files`, `recall: plugkit health verb fields`).

## Site Build & Documentation

Site build + landing render: single-surface detail, drained to rs-learn (`recall: gm site build details`).

**The site consumes the `anentrypoint-design` SDK pro-rata, never overriding it.** `site/theme.mjs` loads SDK at runtime (`unpkg.com/anentrypoint-design@latest`); local `<style>` carries ONLY render-mode plumbing (flatspace html-class toggles `article-flow`/`landing-cap`, crumb media query) + non-SDK site article-layout rhythm -- never a themed visual component. Every graphic-design change (token, component look, TOC/cli/panel/card/callout styling) made IN the SDK repo (`../anentrypoint-design`, GitHub `AnEntrypoint/design`, npm `anentrypoint-design`) as a token-only sheet, published; site picks up via `@latest`. New local CSS styling a visual component = deviation, belongs in SDK. SDK component sheets lint-gated literal-free (every color `var(--token)`); SDK build prefixes selectors `.ds-247420`-scoped. Mechanism: rs-learn (`recall: design SDK pro-rata consumption`).


@.gm/next-step.md
