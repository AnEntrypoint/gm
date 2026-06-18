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

This repo IS the published `gm-skill` npm package: repo root = package root, no factory, no build step generating a separate output dir. `skills/gm-skill/SKILL.md` is the entry point; orchestration logic lives in rs-plugkit, served on demand via the `instruction` verb. Agent-facing prose (phase instruction + gate/residual text) is externalized to an editable `gm-plugkit/instructions/` bundle, so editing prose is a gm-plugkit republish with no Rust rebuild. Mechanism (prose.rs per-key fallback to compiled const; sync-instruction-consts.mjs byte-aligns the .md and the rs-plugkit consts) in rs-learn (`recall: string-externalization project`).

## WASM-only

The plugkit stack runs as a wasm cdylib loaded by `plugkit-wasm-wrapper.js` under Node/bun -- no native binaries built, downloaded, or published. The shipped `plugkit.wasm` (~149MB, embeds bge-small-en-v1.5 for offline in-wasm embeddings) is fetched at bootstrap from `plugkit-wasm` npm / `plugkit-bin` gh-releases, sha256-pinned. Size/embedding mechanics in rs-learn (`recall: WASM-only plugkit size mechanics`).

**Every wasm host-import `extern "C"` block carries `#[link(wasm_import_module = "env")]`** -- in rs-plugkit AND every dep crate linked into the cdylib (rs-learn) AND any sibling building wasm (rs-exec, rs-search); miss it anywhere and the cascade goes dark (local builds stay green, only Linux CI link fails). Incident + host-fn enumeration in rs-learn (`recall: cascade outage wasm import module link`, `recall: wasm host-import link-module trap`).

**`plugkit-wasm-wrapper.js` is ESM; import node builtins at module scope, never inline `require()`** (throws silently under bun's ESM inside `catch(_){}`). Incident in rs-learn (`recall: wrapper require not defined under bun`).

**Every single-instance/lock guard is atomic** (`fs.openSync(path,'wx')` O_EXCL or atomic-rename), never check-then-act; count plugkit processes by executable Name, not command-line substring. Incident in rs-learn (`recall: supervisor churn TOCTOU atomic guard`).

## Spool dispatch ABI

Agents dispatch verbs by writing `.gm/exec-spool/in/<verb>/<N>.txt` and reading `.gm/exec-spool/out/<verb>-<N>.json` (nested) or `out/<N>.json` (root). The wasm orchestrator services every verb; the harness never executes side effects directly.

- **Orchestrator verbs**: `instruction`, `transition`, `phase-status`, `mutable-resolve`, `memorize-fire`, `residual-scan`, `auto-recall`.
- **Wasm-direct verbs**: fs/kv/exec/fetch/env, recall, codesearch, memorize(+prune), health, filter, full git verb family. Enumeration in rs-learn (`recall: wasm-direct plugkit verbs full list`).
- **memorize-prune**: prune bad/superseded memories; two-mode spec (key-delete vs query-review) in rs-learn (`recall: memorize-prune verb two-mode spec`).
- **git verbs**: git is a first-class spool surface, never a shell command; `git_finalize {message}` is the bundled COMPLETE-phase push surface, `git_push` the only admissible raw push (porcelain-gated, rebase-retry). A git-dominant `bash`/`powershell` body is gated (`deviation.bash-git-bypass`). Per-verb shapes + host_git `.exe` resolution in rs-learn (`recall: git verbs rs-plugkit spool surface`).
- **filter**: pure stdout -> compact-stdout transform, in-wasm, no subprocess; pipe raw command output through it before it enters context. Spec in rs-learn (`recall: filter verb rs-plugkit spool spec`).

## Documentation Policy

Record only non-obvious technical caveats that cost multiple runs to discover; remove what no longer applies; never document what is obvious from the code.

**No changelog history in AGENTS.md.** Every entry is a present-tense rule about what must/must-not be the case in code now. Forbidden: `(FIXED)` markers, commit hashes, dated audit entries, `## Learning audit` sections, "(added 2026-...)" annotations, "we used to X, now Y". History belongs in `git log` and `CHANGELOG.md`.

**Detail-heavy caveats live in rs-learn (`.gm/rs-learn.db`), not here.** Per-crate runtime quirks, Windows process-spawn mechanics, hook details, ocw/site/workflow specifics, and similar fact-base material are exfiltrated to rs-learn (`exec:recall`); AGENTS.md keeps only top-level rules governing gm-the-repo. In doubt: cross-cutting policy stays here, single-crate/single-platform mechanism goes to rs-learn.

**Every memorize run also drains AGENTS.md -- migration is bidirectional, deflation is the back-pressure.** AGENTS.md bloats past the budget it protects if flow is only inward, so every session firing `memorize-fire` for new facts ALSO exfiltrates a few existing detail-heavy/single-crate/single-platform entries: fire the substance to the default namespace, then delete or compress the paragraph to a one-line pointer in the same commit. Witnessed by the store gaining the fact AND the byte-count dropping. A few entries per run, never a wholesale rewrite; top-level rules stay, everything recall-reachable drains.

## Coding Style

**No comments in code** -- no inline, block, or JSDoc comments anywhere (source, generated output, hooks, scripts).

**No graphical symbols; convert to industry-standard text on sight.** Decorative glyphs are forbidden in all output and source: arrows, box/geometric glyphs, stars, filled/hollow dots and bullets, checks/crosses, emojis, any non-ASCII decorative symbol. Convert on sight in the same turn (arrow -> `->`, bullet -> `-`/`*`, check/cross -> `[x]`/`[ ]` or done/todo/pass/fail, status dot -> the word). Tell-tale-AI class: one sighting spawns the full-codebase sweep, never a one-off edit. Exempt: functional code operators (`=>`, `??`, `?.`, comparison/math), frozen changelog/git-log entries, binary stores, intentional icon-font/CSS-content product glyphs. `ccsniff --glyph-discipline` flags decorative glyphs post-hoc (run each audit, like `--git-discipline`/`--search-discipline`).

**Skill SKILL.md files:** strip explanatory prose; keep ONLY invocation syntax, transition markers (`->`), gate conditions, constraint lists, exact-usage code examples.

**Implicit, not explicit, in skill prose.** Skill files (and prompt-submit.txt) elicit behavior, they do not describe it: terse imperative principles that trigger already-learned dispositions, not numbered procedures. Forbidden: step-by-step recipes, "see paper section X", citations to the site/papers, multi-step manuals. A skill that reads like a manual gets imitated as a script and breaks at the first edge case. The papers and site are outputs of the discipline, not inputs; never link from a skill into the docs. Cross-cutting rules needing a citation belong here, not in skills.

## Build

No build step; the repo root is the published artifact. `npm publish` from root publishes `gm-skill`; `package.json` `files:` pins the shipped paths. `AnEntrypoint/gm-skill` is a back-compat mirror receiving only `skills/gm-skill/SKILL.md` per release. Canonical install: `bun x skills add AnEntrypoint/gm`.

## The agent is the orchestrator; plugkit is the brain it drives

Plugkit is the stateful library the agent drives by dispatching verbs -- it does not act autonomously, advance phases in the background, or validate transitions while the agent waits. Every state change is a verb the agent writes into `.gm/exec-spool/in/<verb>/<N>.txt`; the dispatch ledger is ground truth, so zero dispatches with a narrated PLAN->COMPLETE walk = a fabricated walk. The PLAN -> EXECUTE -> EMIT -> VERIFY -> COMPLETE state machine lives natively in rs-plugkit (phase/mutables/memorize/transition-legality as data + gate checks), but the agent triggers every operation; plugkit is synchronous from the agent's view, so polling the output dir instead of reading the response file is the canonical misuse. File paths + verb enumeration in rs-learn (`recall: rs-plugkit state-machine internals`).

## gm-skill is the canonical universal harness

`skills/gm-skill/SKILL.md` is the single source of truth for harness behavior and the only skill shipped; the legacy 15-platform fanout (gm-cc/gm-gc/gm-oc/gm-codex/gm-kilo/gm-qwen/gm-hermes/gm-thebird/gm-vscode/gm-cursor/gm-zed/gm-jetbrains/gm-copilot-cli/gm-antigravity/gm-windsurf) is retired and those repos archived. Users install gm-skill directly into whatever harness they use.

## Tool surface is plugkit-only

Every skill's `allowed-tools:` is reduced to `Skill, Read, Write` (plus the SKILL.md boot commands `Bash(bun *)`/`Bash(npx *)`); `Write` is permitted exclusively for spool dispatch. Every other side effect -- code execution, git, browser, recall, memorize, codesearch -- routes through the spool and is serviced by plugkit. The harness never reaches around plugkit; a missing capability is a new plugkit verb, not a skill-side tool.

## Core Rules

**Shared memory & search index are tracked, never ignored**: `.gm/rs-learn.db` and `.gm/code-search/` are committed so state shares across machines, sessions, CI runs. Never add `.gm/`, `.gm/rs-learn.db`, `.gm/code-search/`, or legacy `.code-search/` to ignore rules; transient `.gm/*` entries are listed one-by-one between the managed markers (parent-re-include caveat). Entry list + `ensureGitignored` mechanics in rs-learn (`recall: gm managed-gitignore mechanics`). Project-local persistent state writes under `.gm/<name>/`, never a top-level dotfile/dotdir.

**Disciplines are isolated knowledge stores**: per-project at `<project>/.gm/disciplines/<name>/{rs-learn.db, code-search/}`, each owning its own DB + index. A `@<name>` sigil makes isolation strict (cross-discipline reads forbidden). Without a sigil, reads (recall/codesearch) fan across `default` plus every enabled discipline (one per line in `enabled.txt`), merge-ranked with `[discipline:<name>]` prefixes; writes without a sigil go to `default` only. Disciplines are tracked, never ignored (`ensureGitignored` must not list `.gm/disciplines` or any subpath). The harness and every spool verb propagate the `@<name>` sigil verbatim.

**Nothing fake in source the user runs**: every stub, mock, placeholder return, fixture-only path, demo-mode short-circuit, and "TODO: implement" body is forbidden in shipped code. Scaffolds/shims are permitted only when they delegate to real behavior (real upstream API, subprocess, disk); before adding a shim, check whether a published library already provides the surface. Detection is behavioral: code that always succeeds, returns the same value regardless of input, or short-circuits a real call to satisfy a type signature is a stub. Acceptance is real input through real code into real output, witnessed.

**Spool dispatch gates**: `lib/spool-dispatch.js::checkDispatchGates(sessionId, operation)` reads `.gm/` marker files and returns `{allowed, reason}`; denials surface the reason as imperative instruction, never mutate args. Marker semantics in rs-learn (`recall: spool dispatch gates marker files`).

**Done is plugkit's pronouncement, never the agent's claim**: the chain is COMPLETE only when `transition to=COMPLETE` returns COMPLETE phase and the on-disk state file reflects it. The COMPLETE gate (gates.rs) is the single arbiter -- it refuses on PRD-open, mutables-unresolved, dirty worktree, or missing residual-scan marker. The agent drives the chain into a gate-allowing state, dispatches the verb, reads the response; every alternative is narration.

**Every residual is triaged this turn, never named-and-deferred**: every `git status --porcelain` entry at residual-scan or COMPLETE-attempt is triaged now -- (a) commit (real session/upstream work), (b) add to the managed gitignore block (transient runtime emission like `.gm/witness/`, `.gm/exec-spool/.*-stale.json`), or (c) revert (junk). "Pre-existing residual" is the outcome of triage (a)/(c), never a stop excuse. `blockedBy: external` is admissible only when triage needs authority this session cannot reach; for local-tree files the agent always has authority. Disciplines are tracked; new memorize-fire `mem-*.json` are committed. The managed block (between `# >>> plugkit managed` markers) carries only runtime artifacts with no future read value.

**"Every possible" is the load-bearing test, applied to every noun the request names**: PLAN-phase PRD construction is exhaustive, not minimal -- "every possible" task/validation/mutable/corner-case/caveat/failure-mode/interaction/empty-overflow-reentry/degenerate-input produces rows. A non-trivial request yielding a single-digit PRD has not finished enumerating. After the first pass, the list feeds a second transform: for each row, what every possible corner case looks like becomes more rows; closed when applying "every possible" yields nothing new, not when the agent feels done. Validations, edge cases, anticipated mutables are first-class rows. Long-horizon requests routinely produce high-tens-to-hundreds; the row count is the resolution of the cover, which is what the user asked for. Sparse PRDs orphan the work; dense PRDs make completion observable.

**Every possible aspect that can be checked for jank is a PRD row; the architecture is pliable**: at PLAN, for every surface the prompt concerns, enumerate every aspect checkable for `jank` -- every immaturity, unfinished edge, half-wired path -- across gui/ux/ui/client-state/server-state/the boundary and any surface reached, each its own row including a profiling row and a security row per surface. `jank` is load-bearing: hunt the rough/unpolished/almost-done, not only outright bugs. Scoped to the prompt's concern + its reachable closure, exhaustive within it. Every issue found opens its own debug-and-repair plan spooled the same turn; every quick improvement is spooled too. `pliable`: every architectural change that clearly improves or reduces maintenance burden is a spooled plan -- replacing bespoke code with native functionality or a popular well-maintained library is encouraged ONLY when it nets a smaller maintained surface (a heavy dep for a few lines is the guarded failure mode). Fan-out is the spool-native shape (parallel `prd-add`/`codesearch`/`exec_js`, plugkit task-spawn), never the platform's Task/Explore subagent. One tell-tale AI design element (boilerplate flourish, over-hedged comment, generic scaffold name, machine-authored shape) spawns a full-codebase sweep plan -- scan/per-cluster/fix-and-verify rows, exhaustive over every file, never a one-off fix.

**Client-side debugging exposes globals and evaluates in-browser, never blind-restarts**: surface the relevant state as a `window.*` global and read it live via the `browser` verb's `page.evaluate`, running experiments in the browser, rather than blind experimentation + server restarts. The live page is the debugger; the same `browser` surface that witnesses an edit also diagnoses it.

**Mundane user-facing output is suppressed or stripped to the bone**: drop articles, preamble, play-by-play; boot-probe narration, dispatch echoes, restating prose just read, status recaps do not ship. What survives is substantive: a real finding, a decision + one-line reason, a blocker, the single-line PRD-read declaration. Terse = fewer/shorter words, NEVER zero tool calls and NEVER silent work -- the turn still ends in the chain-advancing tool call.

**Noticing is a planning event, at every phase, in every dispatch window**: any observation -- anything outstanding, unfinished, improvable, misaligned with user preferences, or that the work surfaces about what else it touches -- is a `prd-add` this turn. Observations carried in the response body without conversion evaporate when the turn ends; only the PRD store survives. Density grows along the walk, not just at PLAN-time; a chain exiting PLAN with N rows and reaching COMPLETE with N rows has lost its discoveries. Structural noticing ("no test coverage on X", "docs miss Y", "commit Z violates a rule") and preference-aware noticing (state diverging from dense-PRDs/residual-triage/no-name-and-defer/every-possible-expansion/browser-witness/push-on-clean) each become a row with the witness that motivated it.

**A turn without a tool call is a stop; summary is a stop; both are forbidden until plugkit pronounces COMPLETE**: every programming agent reads only tool calls and their outputs, so a prose-only message ends the turn and halts the session -- the mechanical root of "agent did one piece and stopped". Deferred intent is the same stop facing forward (a turn-final sentence naming the next move instead of making it strands the chain where the prose pointed). Absolute and tool-agnostic: while in-flight (phase != COMPLETE OR prd_pending_count > 0) the agent NEVER ends a turn in prose -- every turn ends in a chain-advancing tool call (`instruction`, the next named verb, `transition`, `phase-status`). Surface a decision through `AskUserQuestion` or `prd-add`, never a prose-only "confirming direction." Only `phase=COMPLETE` AND `prd_pending_count=0` authorizes a prose-only turn; the agent's sense that "the work feels done" authorizes nothing. Before any apparent stop, dispatch `phase-status` and recheck. Depends only on the verb spool, so it holds on every agent with no hook.

**Always seek the next state transition**: not-COMPLETE means a next move exists; idle mid-chain is a deviation. `phase-status` tells you where you are, `instruction` what's next. No "I'll wait for the user" mid-chain -- the user authorized closure at request time, not phase-by-phase.

**Return to plugkit on every possible drift**: `instruction` is the recovery primitive -- against every stall, gate-denial, error, or uncertainty, dispatch `instruction` and read the prose, never improvise. Synchronous, cheap, idempotent; over-dispatching has no cost, under-dispatching is the canonical drift mechanism. Every gate denial names the next verb in its `reason` field; read it and dispatch that verb, never argue around the denial.

**Push is part of COMPLETE, never optional, never asked**: every session that mutates tracked files ends with commit + push to origin. Asking "do you want me to push?" is a deviation -- the push IS the validation dispatch (`verify.rs`). The chain is not COMPLETE until the remote reflects HEAD. ccsniff `--git-discipline` and `deviation.complete-without-push` flag sessions closing without pushing.

**Direct-push to main, never a branch, never a PR**: every gm/rs-* change commits straight to `main` and pushes; the git verbs (`git_finalize`/`git_push`) already target `main`, and the cascade ships from `main`. A feature branch, PR, or fork is a deviation -- the workflow has no review-gate, the push IS the validation dispatch. For a sibling repo with an open PR, merge to `main`, push, delete the branch. The only admissible remote refs are `main` and `gh-pages`; holds for siblings via `git_push {repo, branch:"main"}` as for gm.

**Push requires clean worktree witnessed in its own tool-use event**: `git push` only when `git status --porcelain` is empty, the probe its own Bash event before the push (never `&&`-chained). Prefer `git_push`/`git_finalize` (gate internally). Enforcement locations in rs-learn (`recall: push clean worktree enforcement locations`).

**AGENTS.md / CLAUDE.md are inline-edited AND dual-written to the store**: edit them inline for structural rules (the only doc surviving context summarization), AND `memorize-fire` the same rule so `recall`/`auto_recall` surface it later -- complementary, not alternatives. Never `namespace:"AGENTS.md"`; load-bearing rules go to the default namespace. Mechanics in rs-learn (`recall: memorize-fire ingestion classifier`).

**Behavioral discipline lives in plugkit's `instruction` verb**: dispatch `instruction` for the live phase-specific prose (Three-Layer Admission Filter, maturity-first emit, closure anti-shapes, code invariants); do not duplicate it here. Enumeration in rs-learn (`recall: instruction-verb behavioral discipline invariants`).

**The agent IS the LLM rs-learn calls**: rs-learn never reaches a separate judge model for a quality score, relevance, prune, route, or loss signal -- plugkit IS the harness and the agent IS the model, each an inline decision reported through the spool. Per-core internals in rs-learn (`recall: rs-learn self-report core internals`).

**host_exec_js is synchronous**: pass a real per-call `timeoutMs` (zero/missing is a hard error). Detail in rs-learn (`recall: host_exec_js synchronous`).

**Sync-before-emit (codeinsight + search)**: output must come from a freshly-synced index this invocation (cache serves only on digest match). Mechanics in rs-learn (`recall: sync-before-emit codeinsight search`).

**Auto-recall on turn entry**: `instruction` attaches an `auto_recall` pack on the first dispatch after a >30s idle gap or session-start. Detail in rs-learn (`recall: auto-recall on turn entry`).

**Skill SKILL.md frontmatter `allowed-tools:` is harness-enforced**: a skill must list `Skill` (and `Read`/`Write`, Write only for spool dispatch) or it loses downstream-skill invocation that turn. Detail in rs-learn (`recall: SKILL.md frontmatter allowed-tools`).

**rs-learn observability**: learning-pipeline state changes emit `evt:` lines to `.gm/exec-spool/.watcher.log` + gm-log; recall replies carry per-hit scoring fields. Surface + taxonomy + flags in rs-learn (`recall: rs-learn observability taxonomy`).

**Bootstrap contract**: `ensureReady` initializes wasm hook-free, sha256-rewrites a stale installed SKILL.md, and seeds per-project `CLAUDE.md`/`.gm/next-step.md`. Detail in rs-learn (`recall: skill-initiated bootstrap contract`, `recall: SKILL.md auto-refresh`).

## Cascade pipeline

Push to any rs-* sibling triggers `cascade.yml` -> rs-plugkit `release.yml` -> single `plugkit.wasm` (npm `plugkit-wasm` + `plugkit-bin` Releases) -> auto-bump `gm.json::plugkitVersion` -> `publish.yml` ships gm-skill + gm-plugkit + the SKILL.md mirror. Step sequence + PUBLISHER_TOKEN setup in rs-learn (`recall: cascade pipeline`).

Three npm packages publish from this repo: `gm-skill` (harness), `gm-plugkit` (bootstrap + watcher), `plugkit-wasm` (wasm binary) -- all shipped on every version-bump commit. The legacy 15 downstream repos are archived (no further releases).

**Repos involved (push to any triggers cascade):** `AnEntrypoint/{rs-exec, rs-codeinsight, rs-search, rs-plugkit, rs-learn, gm}` -- rs-plugkit Cargo.toml is the version source-of-truth, gm.json holds plugkitVersion. Per-repo roles in rs-learn (`recall: cascade repos involved roles`).

**To update every possible thing**: push to the relevant repo. No manual version bumps, no local cargo builds -- never run `cargo update`/`cargo build` locally, push and let CI build.

## Spool-dispatch architecture replaces hooks

Orchestration state is tracked via `.gm/` marker files, not hook events; the CLI layer calls `checkDispatchGates()` before tool execution to gate Write/Edit/git. Marker set (`prd.yml, mutables.yml, needs-gm, gm-fired-<sessionId>, residual-check-fired`) + SpoolDispatcher mechanism in rs-learn (`recall: gate enforcement layer`, `recall: spool dispatch gates marker files`).

**gm-skill tool-use sequencing**: `Skill(skill="gm-skill")` writes `.gm/gm-fired-<sessionId>` to clear the needs-gm gate (cleared at turn start to reset it). One shipped skill, no subagent variant.

**The skill is the driver, not a post-hoc witness**: when a request carries the standing instruction to use gm-skill (every `/loop` fire, any prompt naming `/gm-skill`), the FIRST working action is `Skill(skill="gm-skill")`, and the skill prose drives the chain PLAN->COMPLETE. Dispatching spool verbs directly without first entering the skill executes the work outside the skill the user asked to drive it; entering only at the end to confirm terminal state does NOT satisfy the instruction. The boot probe (`cat .gm/exec-spool/.status.json` ...) is prescribed by the skill and may precede invocation; everything that mutates state happens inside the skill-driven session.

**Dead-watcher recovery uses `bun x gm-plugkit@latest spool`, never direct-node boot** (mechanism in rs-learn: `recall: dead-watcher recovery bun x not direct-node`).

**The first verb after a genuine multi-minute IDLE is `instruction`, to reset the long-gap clock**: the gate fires on genuine idle only (>300s since the last instruction AND >300s since any verb), so active back-to-back work verbs keep the chain alive without an interleaved `instruction` -- do not inject defensive instruction dispatches between active work. A true wait (version download, overnight, long external CI watch) trips it, and the first verb back is `instruction`. When the wait is self-inflicted and predictable (a blocking `TaskOutput`/`gh run watch`), dispatch `instruction` immediately BEFORE entering the wait, not only after. "Work verbs"/"any verb" here means SPOOL dispatches -- platform `Bash`/`Read`/`Edit`/`Grep` do NOT reset the clock, so a long investigation run purely in them (the audit `gmsniff`/`ccsniff` sweep + source reading/editing exceeding 300s) trips a false `mid-chain-stall` even while actively working; interleave a `prd-add` (convert each finding as it emerges per density-grows-along-the-walk) or an `instruction` to keep the clock warm. Mechanism in rs-learn (`recall: first verb after multi-minute wait instruction long-gap`).

**A stop-hook firing on a terminal chain does not authorize re-polling**: when a stop-hook fires while already at `phase=COMPLETE` AND `prd_pending_count=0`, re-dispatching `instruction`/`phase-status` to "re-confirm" is a deviation (`deviation.complete-chain-poll`, `instructions/mod.rs`). Two admissible responses: (a) a prose-only turn (COMPLETE is in hand), or (b) genuinely new planned work opened with a FRESH `{"prompt":...}` body (resets phase to PLAN, driven through the skill). Repeatedly answering the same hook is a loop; state the terminal facts once and stop, or open new work.

**Session lifecycle**: background tasks + browser sessions persist across turn-stops; cleanup fires only on real-exit reasons; residual-scan fires when PRD empty AND no open browser sessions AND no running tasks. Detail in rs-learn (`recall: session lifecycle killSessionTasks residual-scan`).

## Spool observability surface

One-shot system-state probe: dispatch `plugkit health` via the file-spool before assuming any component is broken; the runtime diagnostic files at `.gm/exec-spool/` root are readable directly via Read (runtime-data exception). File list + health fields in rs-learn (`recall: spool runtime diagnostic files`, `recall: plugkit health verb fields`).

## Site Build & Documentation

Site build + landing render is single-surface detail, fully drained to rs-learn (`recall: gm site build details`).


@.gm/next-step.md
