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

Repo root = package root = published `gm-skill` npm package; no factory, no separate build-output dir. Entry: `skills/gm/SKILL.md`. Orchestration lives in rs-plugkit, served on-demand via `instruction`.

**`AnEntrypoint/gm-config` is the authored source.** It holds phase prose, gates, residual copy, and the FSM graph. rs-plugkit pulls from it at runtime; it never pushes into it. `prose.rs::resolve()` is the per-key three-tier chain: project-vendored `.gm/instructions/<key>.md`, then `gm-config`'s cached checkout, then a compiled Rust default. `fsm::graph()` runs the same chain for `fsm/graph.json`. `config::resolve()`'s `ImplicitDefaultRepo` tier clones `gm-config` with zero configuration and re-checks it on a debounce (`config_sync.rs`, default 15 min). A hand edit to `gm-config` reaches every project on its next debounce window, with no rs-plugkit rebuild and no release. The 11 phase-prose `.md` files under `crates/plugkit-core/src/orchestrator/instructions/prose/` (entry/specify/prove/emit/state/conc/sec/res/decide/update_docs/browser), `include_str!`'d at build, are that compiled default. They serve only as an emergency fallback. They fire when `gm-config` is genuinely unreachable: offline, a cold start with no cache yet, a network outage. They are never the source of truth. `Outcome::ConfigRepoUnreachable` marks that emergency-fallback case apart from the healthy no-override case, surfaced to the agent as `config_repo_unreachable` on every `instruction`/`transition` response. To run a different default set, fork `gm-config` and point `.gm/config.source.json` at the fork. Editing the compiled `.md` files in rs-plugkit itself never changes what a project resolves. Chain detail: the recall store (`recall: string-externalization project`).

## WASM guest, one native host (agentplug-runner is the sole loader)

Plugkit-core = the wasm cdylib guest (the gm brain), published as `plugkit.wasm`/`plugkit-slim.wasm` from `AnEntrypoint/plugkit-bin` by the cascade. It is host-agnostic, and `agentplug-runner` is the SOLE host that loads it. The JS wasm-host (`plugkit-wasm-wrapper.js` + `gm-plugkit/wrapper/`) and the redundant `gm-runner` native host are both retired -- there is no fallback loader; agentplug-runner is required.

**`agentplug-runner`** (repo `AnEntrypoint/agentplug`, published to `AnEntrypoint/agentplug-bin`) is a real native wasmtime binary that loads gm.wasm as one plugin among siblings (`bert`/`libsql`/`treesitter`), routing gm.wasm's `host_plugin_call`/`host_vec_embed` to those shared plugins -- browser and task are both native in agentplug-host, needing nothing from the retired JS wrapper. Full mechanics: the recall store (`recall: agentplug-runner wasmtime plugin loading mechanics`).

The `gm-plugkit` npm identity stays load-bearing as the thin launcher edge only: `bun x gm-plugkit@latest spool` (`cli.js::tryDelegateToRunner`) re-execs the `agentplug-runner` executable staged at `~/.gm-tools/agentplug-runner` and exits -- there is no silent no-loader state. The launcher-edge install path (`~/.gm-tools`) and the runner's own runtime state (`~/.agentplug`) are two different directories; always check `~/.agentplug/plugins/gm.version` for what is actually being served, never `~/.gm-tools`. Full path-split mechanics: the recall store (`recall: agentplug-runner runtime-state path split`). Size + embedded-model mechanics: the recall store (`recall: WASM-only plugkit size mechanics`).

**`bin/install.js` hard-requires agentplug-runner.** It downloads the sha256-verified native runner from `AnEntrypoint/agentplug-bin` for the host platform, and if none is published (or the download/check fails) it fails the install loudly with a clear message rather than leaving the user with no loader. There is no JS-host fallback to silently fall through to anymore.

**agentplug-runner auto-updates both the wasm it serves and its own executable, fully autonomously.** Two independent 600s polls; a staged `.new` runner is swapped in by a self-triggered takeover handoff on the next idle tick, so no `bin/install.js` re-run and no restart is ever required. A dispatch landing mid-handoff can return `dispatch_orphaned` -- expected, bare re-dispatch is the fix, never a different recovery path. The per-project `.status.json` heartbeat (read on every turn boot probe) surfaces this directly: `runner_update_in_progress`/`runner_update_waiting_ms` while a handoff is mid-flight, `last_completed_runner_swap` (`{version, swapped_at_ts}`) as the durable just-swapped record, `loaded_plugin_versions` for the currently-loaded gm/bert/libsql/treesitter versions. Poll-liveness signal (`daemon-status.json` poll timestamps, never the retired JS host's cache files) and non-semver sideload protection: the recall store (`recall: agentplug daemon.rs self-update handoff protocol`, `recall: agentplug-runner update-poll observability sideload`).

Wasm host-import link-module rule (`#[link(wasm_import_module="env")]` on every host-import extern block, every dep crate): the recall store (`recall: wasm host-import link-module trap`).

**Every single-instance/lock guard is atomic** (O_EXCL / atomic-rename), never check-then-act (recall store: `recall: supervisor churn TOCTOU atomic guard`).

## Spool dispatch ABI

Dispatch = Write `.gm/exec-spool/in/<verb>/<N>.txt`, Read `.gm/exec-spool/out/<verb>-<N>.json` (nested) or `out/<N>.json` (root). Wasm orchestrator services every verb; harness never executes side effects directly.

- **Orchestrator verbs**: `instruction`, `transition`, `phase-status`, `mutable-resolve`, `memorize-fire`, `residual-scan`, `auto-recall`.
- **Wasm-direct verbs**: fs/kv/exec/fetch/env, recall, codesearch, memorize(+prune), health, filter, full git verb family. Enumeration in the recall store (`recall: wasm-direct plugkit verbs full list`).
- **Host-native verb**: `background-convert` (`{verb, task}`) detaches an already-in-flight dispatch so the daemon worker stops waiting on it -- agent-initiated only, never routed to gm.wasm. Detail: `.gm/daemon-config-reference.md`.
- **memorize-prune**: prune bad/superseded memories; two-mode spec (key-remove vs query-review) in the recall store (`recall: memorize-prune verb two-mode spec`).
- **git verbs**: git is a first-class spool surface, never a shell command; `git_finalize {message}` is the bundled COMPLETE-phase push surface, `git_push` the only admissible raw push (porcelain-gated, rebase-retry). A git-dominant `bash`/`powershell` body is gated (`deviation.bash-git-bypass`). Per-verb shapes + host_git `.exe` resolution in the recall store (`recall: git verbs rs-plugkit spool surface`). `git_finalize` also runs `ci-status` inline right after push and auto-writes `.gm/exec-spool/.ci-validated` on a green result -- no separate poll-then-marker dispatch needed. The `ci-validated-fresh` COMPLETE gate compares that marker's `head_sha` against current HEAD and names `ci-status` as its `next_dispatch` on denial. An async git host (one that answers host_git with `{pending,token}` and parks the terminal result in kv ns `outbox`) is served by the `git_poll {token}` verb: `git_status`/`git_add`/`git_commit`/`git_log`/`git_diff` return pending envelopes there, and the caller repeats `git_poll` until a non-pending envelope comes back -- that envelope is the verb's terminal result, plan-resumed across dispatches for compound verbs.
- **filter**: pure stdout -> compact-stdout transform, in-wasm. Spec + usage (pipe raw command output through it before context) in the recall store (`recall: filter verb rs-plugkit spool spec`).

## Documentation Policy

Record only non-obvious multi-run-cost caveats; prune stale; never document the code-obvious.

**ASD-STE100 sets word choice and sentence grammar.** This Documentation Policy sets what content to write. The two rules apply together. Write short sentences: 20 words for a procedural sentence, 25 for a descriptive one. Write one idea per sentence. Use the active voice. Use an approved word from `.gm/disciplines/ste100/dictionary.json` in place of a banned synonym. This policy still decides whether a caveat is worth a line at all, and how much survives past the non-obvious core. STE100 forbids a clipped, telegraphic style; this repo's density rule still forbids narrative bloat and code-obvious restatement. A compliant sentence is short and complete, never a dropped-word fragment. Full rules and the machine-checkable dictionary: `.gm/disciplines/ste100/policy.md` and `.gm/disciplines/ste100/dictionary.json`. Run `.gm/disciplines/ste100/verify-run.mjs` on a touched prose file before the VERIFY phase accepts it.

**No changelog history in AGENTS.md.** Every entry is a present-tense rule about what must/must-not be the case in code now. Forbidden: `(FIXED)` markers, commit hashes, dated audit entries, `## Learning audit` sections, "(added 2026-...)" annotations, "we used to X, now Y". History belongs in `git log` and `CHANGELOG.md`.

**A memo is prune-worthy, not durable, when it restates something the reader could get faster another way, or when it will go stale and mislead.** Three classes, checked on every `memorize-fire` and on sight in `.gm/memories/`: (a) config-derivable -- a value readable straight from `gm.config.json`/`graph.json`/any live config file belongs to that file, not a memo restating it; (b) trivially-discoverable-from-code -- a fact one `codesearch`/`Read` away needs no memory, since the code itself answers faster and can't drift out of sync with a stale copy; (c) state-of-tooling snapshot -- a specific version number, plugin-load state, or runtime status captured at one point in time will go stale and mislead a future session into treating it as still current. None of the three survive `memorize-prune`. What does survive: a debugging root-cause finding, a non-obvious invariant, or a cross-cutting method lesson -- each says something the source alone does not, and stays true regardless of when it is read.

**Detail-heavy caveats live in the recall store (`.gm/memories/` corpus), not here.** Per-crate/OS/hook/workflow fact-base -> `recall`; AGENTS.md keeps top-level gm-repo-governing rules only. Cross-cutting policy stays; single-crate/single-platform mechanism drains.

**gm's recall store (`.gm/memories/` project corpus) holds gm/rs-* method/tooling/invariants ONLY -- never target-project specifics.** A finding ABOUT a project gm merely drives ON (its paths, line numbers, `.gm/prd.yml`/`mutables.yml` contents, app internals, versions) belongs in THAT project's own `.gm` store -- pollutes every gm session's recall otherwise. Using gm != working on the driven project: scrub names/paths/state, keep only the generalizable gm-method lesson. Binds `mutable-resolve`/`prd-resolve` auto-memo too -- witness in gm-method terms, never by quoting foreign tree. (Code-side classifier reject rejected as too brittle -- false-rejects legit `.gm/prd.yml` mechanism citations -- so discipline + on-sight `memorize-prune` of foreign-specific memos is the enforcement.)

**Every memorize run also drains AGENTS.md -- bidirectional migration, deflation is the back-pressure.** Inward-only flow bloats past budget: every `memorize-fire` session ALSO exfiltrates a few detail-heavy/single-crate/single-platform entries -- fire substance to default namespace, compress paragraph to one-line pointer, same commit. Witness: store gains fact, byte-count drops. Few per run, never wholesale; top-level rules stay, recall-reachable detail drains. Byte-ceiling checked manually on sight, not by an automated guard (`recall: AGENTS.md byte-ceiling guard looper bloat`).

## Coding Style

**No test files or test suites of any kind, ever -- manual troubleshooting and debugging through real code execution is the only verification surface.** No `*.test.*`/`*.spec.*` files, no `test/`/`__tests__/`/`spec/` directories, no jest/mocha/vitest/pytest/unittest/junit or any assertion/mocking library, in this repo or any repo gm drives work in -- and no standing root-level test file either. Verification is running the real thing and reading the real output -- `exec_js`/`browser` witnessing a live invariant, same turn as the code it checks. A PRD row for "add validation"/"handle edge case X" is closed by exercising that case live, never by authoring a test case that exercises it later. Rationale + measured impact on coder throughput: the recall store (`recall: synthetic-test-file coder-performance regression`). Full phase-level enforcement (SPECIFY's edge-case rows, EMIT's hard rule, DECIDE's adversarial corner-case sweep) lives in rs-plugkit's served `instruction` prose, not duplicated here.

**Self-explanatory code replaces the comment; the comment is never written in the first place.** A name, a function boundary, an extracted variable, or a small type IS the explanation -- prefer renaming/restructuring over annotating every single time a comment urge appears. No inline, block, doc (`///`, `/**`, `#`, JSDoc), or rationale comments anywhere (source, generated output, hooks, scripts, Rust, JS/TS, shell, YAML). A multi-line or paragraph-long comment is the same violation at higher volume, not a lesser one -- it is not exempted by explaining a "why"; that urge to explain is itself the signal that a name or structure is doing too little work, so restructure instead of narrating around the gap. If a rule/tradeoff genuinely needs recording for future sessions (not this code), it goes in AGENTS.md or the recall store, never inline next to the code.

**A comment encountered anywhere -- pre-existing, another session's, a dependency's vendored copy inside this repo's own tracked tree -- is converted to self-explanatory code the moment it's seen, same turn, not left for a later cleanup pass.** Read the comment, understand what it was compensating for (an unclear name, an un-extracted step, an unstated invariant), fix that root cause so the comment's content becomes redundant, then remove the comment. "Already there, not part of this task" is not an exemption -- the same one-sighting-spawns-a-sweep discipline that governs every other tell-tale-AI class in this section applies here: a comment survives only until the next file touching it is opened. Checked manually on sight across every tracked source extension (`.rs`, `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.sh`, `.ps1`); one sighting spawns the full-tree sweep.

**No UTF-8 BOM in any tracked source file** -- always `-Encoding utf8` (no BOM) or the `Write` tool; PowerShell defaults betray this. Checked manually on sight; one sighting spawns the full-tree sweep. Cause + breakage mechanics in the recall store (`recall: BOM regression incident`).

**No graphical symbols; convert to industry-standard text on sight.** Any non-ASCII decorative glyph (arrows, box/geometric glyphs, stars, dots, bullets, checks/crosses, emojis) is forbidden in all output and source -- convert it to its plain-ASCII equivalent the same turn (the word, `->`, `-`/`*`, `[x]`/`[ ]`, done/todo/pass/fail). Tell-tale-AI class: one sighting spawns the full-codebase sweep, never a one-off edit. Exempt: functional code operators (`=>`, `??`, `?.`, comparison/math), frozen changelog/git-log entries, binary stores, intentional icon-font/CSS-content product glyphs. `ccsniff --glyph-discipline` flags decorative glyphs post-hoc (run each audit, like `--git-discipline`/`--search-discipline`/`--verb-bypass-discipline`/`--spool-discipline`).

**Implicit, not explicit, in skill prose**: skill files elicit, never describe -- terse imperatives, no recipes/citations/manuals; boot-edge ABI (spool paths, JSON fields, verb names, deviation ids, gate names) stays explicit; SKILL.md keeps only invocation syntax, transition markers, gate conditions, constraints, exact-usage examples. Full criteria: the recall store (`recall: implicit-not-explicit skill prose criteria`).

## Build

No build step; repo root = published artifact. `npm publish` from root ships `gm-skill` (permanent npm id; skill DIR is `skills/gm`, command is `/gm`). `package.json` `files:` pins shipped paths. `AnEntrypoint/gm-skill` = back-compat mirror, receives only `skills/gm/SKILL.md` per release.

`bin/install.js` = canonical installer (no npx `skills` lib, no marketplace); landed dir name IS the `/command`; verified by manually running the installer and checking the landed tree, not an automated guard. Copy-target, four non-interactive Claude Code settings, reasoning-in-code framing: the recall store (`recall: gm installer detail`).

## The agent is the orchestrator; plugkit is the brain it drives

Plugkit = stateful library the agent drives by verb dispatch -- never autonomous, never background-advances phases, never validates while agent waits. State change = verb written to `.gm/exec-spool/in/<verb>/<N>.txt`; dispatch ledger is ground truth, so zero-dispatch narrated SPECIFY->COMPLETE = fabricated. SPECIFY -> PROVE -> EMIT -> STATE -> CONC -> SEC -> RES -> DECIDE -> COMPLETE lives natively in rs-plugkit as a non-linear graph (phase/mutables/memorize/transition-legality as data + gate checks) with feedback edges from every later stage back to SPECIFY/EMIT/STATE/PROVE; agent triggers every op, plugkit synchronous from agent's view -- polling output dir instead of reading response = canonical misuse. DECIDE owns adversarial verification + git-push + CI/CD validation, gated by the full closure set into COMPLETE. File paths + verb enumeration: the recall store (`recall: rs-plugkit state-machine internals`).

## gm is the canonical universal harness

`skills/gm/SKILL.md` = single source of truth; one skill shipped, legacy 15-platform fanout retired. Install: `bun x skills add AnEntrypoint/gm`. Detail: the recall store (`recall: legacy gm-skill variants retired`).

## Tool surface is plugkit-only

Every skill's `allowed-tools:` reduced to `Skill, Read, Write` (plus SKILL.md boot `Bash(bun *)`/`Bash(npx *)`); `Write` exclusively for spool dispatch. Every other side effect -- exec, git, browser, recall, memorize, codesearch -- routes spool -> plugkit. Never reach around plugkit; missing capability = new plugkit verb, not skill-side tool.

**Subagent/Workflow-agent prompts delegate, never restate.** Any `Agent()` tool call or `Workflow` script `agent()`/`pipeline()`/`parallel()` call dispatching gm-driven work says only "use the gm skill for this" (or equivalent minimal pointer) plus the task-specific content -- target repo/path, what to investigate, what to report. Never inline verb names, spool paths, JSON body shapes, or phase-chain mechanics into the prompt string: `Skill(skill="gm")` already supplies all of that on invocation, so restating it is instructional content living outside plugkit+skill, the exact drift this file's own tool-surface rule exists to prevent. Applies identically to both surfaces -- a Workflow script author writing full gm-protocol prose into an `agent()` prompt is the same violation as an `Agent()` call doing it.

A task that reduces to read/investigate/report, or a change confined to files the subagent owns for the turn, dispatches straight through -- stating the read-only boundary explicitly ("report only, no writes") is task-scope, not gm-protocol restatement, so it's not a violation of the rule above. A task whose plain description asks for an irreversible or shared-state-affecting action (remove data, force-push, merge/close a PR, deploy, rename a shared branch) is not silently handed off -- name the risk in the prompt and require the subagent to surface it back rather than execute it, the same blast-radius judgment the top-level agent applies to its own actions; the action still routes through the gm-driven skill invocation, never a prompt-authored imperative sequence that bypasses it. Contrast: "find every caller of X and summarize" dispatches as-is; "drop the staging table and reseed it" gets confirmed before any subagent is scoped to carry it out.

**A subagent dispatched to build/commit/push in a submodule (`agentplug`, `rs-plugkit`, `rs-codeinsight`, `agentplug-bert`, `agentplug-libsql`, `agentplug-treesitter`, `rs-search`, `gm-config`) closes the loop back to gm's own pin as its last step, every time, no exceptions.** Full procedure + incident history: the recall store (`recall: gm submodule-pin-drift incident history`).

## Core Rules

**Memory is human-readable md, tracked; derived stores are transient, never tracked.** Detail: the recall store (`recall: gm memory storage mechanics`, `recall: gm managed-gitignore mechanics`).

**Disciplines are isolated knowledge stores**, tracked, `@<name>` sigil-scoped, enabled list at `.gm/disciplines/enabled.txt` (one name per line; `discipline_note.rs::active_policies()` auto-surfaces each enabled discipline's `.gm/disciplines/<name>/policy.md` on every `instruction`). Detail: the recall store (`recall: gm disciplines mechanics`).

**Every runtime config surface, indexed**: `.gm/instructions/<key>.md`+`source.json` (prose vendoring, see above), `.gm/instructions/fsm/graph.json` (phase-graph override via `fsm-vendor`), `.gm/instructions/hooks/<name>.js` (jit-hook, fails closed), `.gm/browser-config.json`, `.gm/daemon-project-config.json`, `~/.agentplug/daemon-config.json`, `.gm/disciplines/enabled.txt`, env toggles (`AGENTPLUG_NO_DAEMON`/`CLAUDE_PROJECT_DIR`/`GM_PLUGKIT_SKIP_SELF_STALE_CHECK`/`AGENTPLUG_EXTRA_CA_CERTS`). `AGENTPLUG_EXTRA_CA_CERTS` (falls back to `SSL_CERT_FILE` if unset) points at a PEM file of extra trust anchors layered on top of the compiled-in webpki-roots set -- the escape hatch for a TLS-terminating proxy environment where the default rustls trust store cannot verify the proxy's own certificate; every agentplug-host HTTP call (plugin download, runner self-update poll, the `fetch` verb) shares one `ureq::Agent` built with this store. Field-level detail: `.gm/daemon-config-reference.md` and the recall store (`recall: gm runtime config surface field defaults`).

**Nothing fake in source the user runs**: stub/mock/placeholder-return/fixture-only-path/demo-mode-short-circuit/"TODO: implement" forbidden in shipped code. Scaffolds/shims permitted only delegating to real behavior (upstream API, subprocess, disk); check for an existing library before adding a shim. Detection = behavioral: always-succeeds, input-invariant, or type-signature-satisfying short-circuit = stub. Acceptance = real input through real code into real output, witnessed. `Mock*`/`Fake*`/`Stub*` names checked at DECIDE explicitly, not left prose-only (`recall: nevil false-completion mock-network incident`). A row marked `completed` by documenting it (a README "Future Optimizations" section, a design note) instead of implementing it is the same violation -- `prd-resolve` structurally refuses two PRD rows sharing byte-identical `witness_evidence` text (`deviation.prd-resolve-duplicate-witness`), the copy-paste tell of rubber-stamped completion.

**Spool dispatch gates**: denials surface reason as imperative instruction, never mutate args. Implementation + marker semantics: the recall store (`recall: spool dispatch gates marker files`).

**Done is plugkit's pronouncement, never the agent's claim**: COMPLETE only when `transition to=COMPLETE` returns COMPLETE phase, on-disk state reflects it. COMPLETE gate (gates.rs) = sole arbiter -- refuses on PRD-open, mutables-unresolved, dirty worktree, missing residual-scan marker. Agent drives into gate-allowing state, dispatches, reads response; every alternative is narration.

**Every residual is triaged this turn, never named-and-deferred**: every `git status --porcelain` entry at residual-scan/COMPLETE-attempt triaged now -- (a) commit (real work), (b) managed-gitignore-block (transient runtime emission, e.g. `.gm/witness/`, `.gm/exec-spool/.*-stale.json`), (c) revert (junk). "Pre-existing" = the (a)/(c) outcome, never a stop excuse. Everything is fixable: when triage points outside the local tree, the row's job is the concrete reach action that builds past it (open the PR, script the credential path, replace/drive-directly the broken tool), never a `blockedBy: external` resting state -- `blockedBy` only transiently carries that reach path forward while it is built, and local-tree files are always agent-authoritative to fix now. Disciplines + new memorize-fire `mem-*.json` committed. Managed block (`# >>> plugkit managed` markers) carries only zero-future-read-value runtime artifacts.

**"Every possible" is the load-bearing test, applied to every noun the request names** -- PRD density at SPECIFY, second-pass corner-case transform: the recall store (`recall: PLAN-phase PRD density rule`).

**Every possible aspect checkable for jank is a PRD row; architecture is pliable** -- per-surface jank enumeration at SPECIFY, pliable-architecture guard, AI-tell sweep trigger: the recall store (`recall: jank sweep rule PLAN`).

**Client-side debugging exposes globals and evaluates in-browser, never blind-restarts**: live page = the debugger (recall store: `recall: client-side-debug-globals-live-page`).

**Mundane user-facing output is suppressed or stripped to the bone**: drop articles/preamble/play-by-play/boot-probe narration/dispatch echoes/restated-prose/status recaps. Survives: real finding, decision+one-line-reason, blocker, single-line PRD-read declaration. Terse = fewer words, NEVER zero tool calls, never silent work -- turn still ends chain-advancing.

**Noticing is a planning event, at every phase, in every dispatch window**: any observation (outstanding/unfinished/improvable/preference-misaligned/adjacent-surface) -> `prd-add` this turn. Response-body-only observations evaporate; only PRD store survives. Density grows along the walk, not just PLAN -- exiting PLAN with N rows and reaching COMPLETE with N rows = lost discoveries. Structural noticing (missing coverage/docs, rule-violating commit) and preference-aware noticing (drift from dense-PRDs/residual-triage/no-defer/every-possible/browser-witness/push-on-clean) each -> a row with its witness.

**A turn without a tool call is a stop; summary is a stop; both forbidden until plugkit pronounces COMPLETE**: agents read only tool calls+outputs, so prose-only ends the turn -- mechanical root of "did one piece and stopped." Deferred intent = same stop facing forward (naming the next move instead of taking it strands the chain). Absolute, tool-agnostic: in-flight (phase!=COMPLETE OR prd_pending_count>0) -> every turn ends in chain-advancing dispatch (`instruction`, next verb, `transition`, `phase-status`). Decisions surface via `AskUserQuestion`/`prd-add`, never prose. Only `phase=COMPLETE AND prd_pending_count=0` authorizes prose-only; "feels done" authorizes nothing. Apparent stop -> dispatch `phase-status`, recheck.

**Always seek the next state transition**: not-COMPLETE = next move exists; idle mid-chain = deviation. `phase-status` = where; `instruction` = what's next. No "wait for user" mid-chain -- closure was authorized at request time.

**Return to plugkit on every possible drift**: `instruction` = sole recovery primitive -- stall/gate-denial/error/uncertainty -> dispatch, read, never improvise. Synchronous, cheap, idempotent; over-dispatch free, under-dispatch = canonical drift. Gate denial names next verb in `reason`; dispatch that, never argue around it.

**Push is part of COMPLETE, never optional, never asked**: tracked-file-mutating session ends commit+push to origin. "Want me to push?" = deviation -- push IS the validation dispatch (`verify.rs`). Not-COMPLETE until remote reflects HEAD. ccsniff `--git-discipline` + `deviation.complete-without-push` flag unpushed closes.

**Direct-push to main, never a branch, never a PR**: every gm/rs-* change -> straight `main` commit+push; git verbs (`git_finalize`/`git_push`) already target `main`, cascade ships from `main`. Branch/PR/fork = deviation, no review-gate exists. Sibling repo with open PR: merge to `main`, push, remove the branch. Only admissible remote refs: `main`, `gh-pages` -- `git_push {repo, branch:"main"}` for siblings too.

**Push requires clean worktree witnessed in its own tool-use event**: `git push` only on empty `git status --porcelain`, probed its OWN Bash event before push (never `&&`-chained). Prefer `git_push`/`git_finalize` (internal gate). Enforcement locations: the recall store (`recall: push clean worktree enforcement locations`).

**Any history rewrite or force-push sourced from an external clone/mirror verifies that source's ancestry against live HEAD first**, `git merge-base --is-ancestor` gated. Detail: the recall store (`recall: gm history-rewrite force-push ancestry safety rule`).

**A `git checkout <branch>` that leaves commits behind names EVERY dangling commit, not one candidate to trust blind**: ancestry-safe (`git merge-base --is-ancestor`) is not automatically content-complete when multiple dangling commits chain together -- check the real recovery by grepping pushed content on origin for the expected change, never by trusting `git_push`'s own summary line alone. Full incident + recovery mechanics: the recall store (`recall: wrong dangling commit git recovery`).

**AGENTS.md / CLAUDE.md are inline-edited AND dual-written to the store**: inline-edit for structural rules (only doc surviving context summarization), AND `memorize-fire` the same rule for `recall`/`auto_recall` surfacing -- complementary, not either/or. Never `namespace:"AGENTS.md"`; load-bearing rules -> default namespace. Mechanics: the recall store (`recall: memorize-fire ingestion classifier`).

**A memorized workaround is a tool defect; transform it, never accumulate it**: using gm != working on gm, so a workaround/known-limitation-framed `recall` memo is tribal knowledge that surprises a fresh user/LLM -- surprises forbidden, everything must be predictable at face value. Resolve: (a) already in standing prose -> prune; (b) prose-worthy, absent -> add then prune; (c) genuinely surprising -> fix code predictable then prune.

**Behavioral discipline lives in plugkit's `instruction` verb**: dispatch `instruction` for live phase-specific prose (Three-Layer Admission Filter, maturity-first emit, closure anti-shapes, code invariants); not duplicated here. Enumeration: the recall store (`recall: instruction-verb behavioral discipline invariants`).

**The agent IS the LLM the recall pipeline calls**: no separate judge model; decisions inline via spool. Internals: the recall store (`recall: rs-learn self-report core internals`).

**Idempotency contract (f∘f≡f)**: spool dispatch is at-least-once; correctness rests on per-verb convergence (content-hash dedup, nothing-to-commit gates, digest gates); read-only verbs recompute, never cache. Per-verb enumeration: the recall store (`recall: idempotency contract per-verb convergence`).

**Every exec-family verb requires a real per-call `timeoutMs`** (`exec_js`/`host_exec_js` and every language stem it backs -- `bash`, `python`, `powershell`, `ssh`, `go`, `rust`, `c`, `cpp`, `java`, `deno` -- all route through the same synchronous host call): zero or missing `timeoutMs` is a hard error, not a default-substituted value. Detail: the recall store (`recall: host_exec_js synchronous`).

**Sync-before-emit (codeinsight + search)**: output must come from this-invocation freshly-synced index (cache serves only on digest match). Mechanics: the recall store (`recall: sync-before-emit codeinsight search`).

**Auto-recall on turn entry**: `instruction` attaches `auto_recall` pack on first dispatch after >30s idle gap / session-start. Detail: the recall store (`recall: auto-recall on turn entry`).

**Skill SKILL.md frontmatter `allowed-tools:` is harness-enforced**: must list `Skill` (+`Read`/`Write`, Write only for spool dispatch) or loses downstream-skill invocation that turn. Detail: the recall store (`recall: SKILL.md frontmatter allowed-tools`).

**Recall observability**: pipeline state changes emit `evt:` lines to `.gm/exec-spool/.watcher.log` + gm-log; recall replies carry per-hit scoring fields. Taxonomy: the recall store (`recall: rs-learn observability taxonomy`).

**Bootstrap contract**: `ensureReady` inits wasm hook-free, sha256-rewrites stale installed SKILL.md, seeds per-project `CLAUDE.md`/`.gm/next-step.md`. Detail: the recall store (`recall: skill-initiated bootstrap contract`, `recall: SKILL.md auto-refresh`).

## Cascade pipeline

Push to any rs-* sibling -> `cascade.yml` -> rs-plugkit `release.yml` -> single `plugkit.wasm` (npm `plugkit-wasm` + `plugkit-bin` Releases) -> best-effort gm-metadata-sync commit -> `publish.yml` ships gm-skill+gm-plugkit+SKILL.md mirror. Step sequence + PUBLISHER_TOKEN: the recall store (`recall: cascade pipeline`).

**`gm.json.plugkitVersion` is informational-only, never a functional pin** -- nothing reads it; the real runtime pin is `gm-plugkit/plugkit.version`, always overridden by `resolveLatestRemoteVersion()` before use. `publish.yml`'s drift-check no longer gates on it. Mechanism detail: the recall store (`recall: gm cascade pin-toil design`).

**Every downloaded wasm artifact is sha256-verified against the sha published alongside that exact resolved release, fetched fresh, never against a locally-committed value alone** -- `gm-plugkit/bootstrap.js::fetchRemoteSha()`. Floating past the committed pin never weakens verification. Detail: the recall store (`recall: gm cascade pin-toil design`).

**Submodule pointers auto-sync via `.github/workflows/submodule-sync.yml`**, 30min schedule. Mechanics + manual-recovery fallback: the recall store (`recall: gm submodule pointer auto-sync mechanics`).

The `gm-runner` crate and its separate `gm-runner.yml` CI workflow are retired along with the binary itself (see the WASM-guest section above) -- confirmed absent from rs-plugkit's `crates/` and `.github/workflows/`, no longer a stage in the cascade.

**The three agentplug-* wasm-plugin repos (agentplug-bert, agentplug-libsql, agentplug-treesitter) share one reusable release workflow** hosted in rs-plugkit (`wasm-plugin-release.yml`, `workflow_call`). Parameterization + the build_env/pre_build_steps quoting caveat: the recall store (`recall: gm cascade pin-toil design`).

**Repos involved (push to any triggers cascade):** `AnEntrypoint/{rs-codeinsight, rs-search, rs-plugkit, gm}`. rs-learn and rs-exec are retired (crates removed from / never depended on by rs-plugkit; their spool-dispatch and memory surfaces reimplemented natively in rs-plugkit wasm_dispatch; repos archived as tombstones, README points at rs-plugkit). Roles, npm package names, legacy-retirement detail: the recall store (`recall: cascade repos involved roles`, `recall: legacy gm-skill variants retired`).

**agentplug is a separate parallel pipeline that CONSUMES the cascade's output, not a stage in it**, decoupled at the `plugkit-bin` release artifact. Detail: the recall store (`recall: agentplug parallel pipeline decoupling`).

**Repo inventory** (authoritative list; `.gitmodules` is ground truth for submodules):

| repo | role |
| --- | --- |
| agentplug, agentplug-bert, agentplug-libsql, agentplug-treesitter, gm-config, rs-codeinsight, rs-plugkit, rs-search | active-dependency (submodule) |
| rs-codeinsight, rs-search, rs-plugkit, gm | active-sibling (cascade trigger) |
| rs-learn, rs-exec, gm-runner-bin, 12 legacy gm-\<platform\> repos | retired-tombstone (archived, README points at rs-plugkit) |

**To update every possible thing**: push to the relevant repo. No manual version bumps, no local `cargo update`/`cargo build` -- push, let CI build.

## Spool-dispatch architecture replaces hooks

Orchestration state tracked via `.gm/` marker files, not hook events; the gate that admits Write/Edit/git pre-execution runs natively inside `plugkit.wasm`. Marker set + gate mechanism + retired-JS-reimplementation history: the recall store (`recall: gate enforcement layer`, `recall: spool dispatch gates marker files`).

**gm tool-use sequencing**: `Skill(skill="gm")` clears needs-gm gate. One shipped skill, no subagent variant. Marker mechanics: the recall store (`recall: gm-skill tool-use sequencing mechanics`).

**The skill is the driver, not a post-hoc witness**: standing instruction to use gm skill (every `/loop` fire, any `/gm` prompt) -> FIRST action is `Skill(skill="gm")`, skill prose drives SPECIFY->COMPLETE. Direct spool verbs without entering the skill first = work executed outside the requested driver; end-only entry to check terminal state does NOT satisfy the instruction. Boot probe (`cat .gm/exec-spool/.status.json` ...) may precede invocation; every state mutation happens inside the skill-driven session.

**Dead-watcher recovery uses `bun x gm-plugkit@latest spool`, never direct-node boot** (mechanism: recall store `recall: dead-watcher recovery bun x not direct-node`).

**Starting the spool is one atomic blocking call**: `bun x gm-plugkit@latest spool` daemonizes AND blocks until `.status.json` heartbeats fresh (exit 0 only when serving). Cli-side wait mechanics: the recall store (`recall: atomic spool boot cli-side wait`).

**Apparent tooling failure is mechanical self-recovery, NEVER a question for the user and never an a/b-test/blind-restart.** Missing spool response / stale watcher = agent's own job: honor future `busy_until` else boot+re-dispatch -- spooler is sound by construction, asking the user to do what a verb can do is a paper-spirit violation. Recovery mechanics (atomic `.status.json`, `FailedToOpenSocket` retry, debug-via-`window.*`-globals): the recall store (`recall: spooler self-recovery mechanics`).

**Process-of-elimination is the debugging paradigm EVERYWHERE, and manual real-services witness is the verification paradigm EVERYWHERE** -- both stated in `instructions/prose/decide.md` (served DECIDE prose). Detail: the recall store (`recall: process-of-elimination manual-real-services-witness paradigm`).

**The first verb after a genuine multi-minute IDLE is `instruction`, to reset the long-gap clock**: only spool verbs reset it, so long platform-tool investigation trips false stall -- interleave `instruction`/`prd-add` to stay warm, dispatch `instruction` BEFORE any predictable blocking wait. Threshold + exception: the recall store (`recall: first verb after multi-minute wait instruction long-gap`).

**A stop-hook firing on a terminal chain does not authorize re-polling** (`deviation.complete-chain-poll`): prose-only turn or fresh `{"prompt":...}` only. Detail: the recall store (`recall: complete-chain-poll stop-hook responses`).

Session lifecycle (task/browser persistence across turn-stops, residual-scan trigger conditions): the recall store (`recall: session lifecycle killSessionTasks residual-scan`).

Browser session state roots at the git common dir, never `process.cwd()` (worktree fan-out shares one chromium, not N): the recall store (`recall: browser session state worktree common-dir rooting`).

**Absence of file edits never authorizes skipping a browser witness.** `browser-witness-coverage` only checks files edited this turn and is vacuously satisfied by an empty edit list -- the separate `app-loads-witnessed` gate on DECIDE->COMPLETE closes that gap: any project with `.gm/browser-config.json` present must record a same-turn healthy `browser` dispatch regardless of edit count, or the transition refuses. A confirmation/audit turn asserting the app works is itself a claim requiring the same live witness a code-change turn needs.

## Spool observability surface

One-shot system-state probe: dispatch `plugkit health` before assuming any component broken; runtime diagnostic files at `.gm/exec-spool/` root readable directly via Read (runtime-data exception). File list + health fields: the recall store (`recall: spool runtime diagnostic files`, `recall: plugkit health verb fields`).

## Site Build & Documentation

Site build + landing render: single-surface detail, drained to the recall store (`recall: gm site build details`).

**The site consumes the `anentrypoint-design` SDK pro-rata, never overriding it.** Every visual change lands in the SDK repo, never local CSS; local `<style>` = render-mode plumbing only. Mechanism + repo pointers: the recall store (`recall: design SDK pro-rata consumption`).


@.gm/next-step.md
