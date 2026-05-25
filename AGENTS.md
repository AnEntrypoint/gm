# AGENTS.md

--JULES STOPGAP DONT EDIT START--

## Skills

This project has task-specific skills available.

> **MANDATORY:** Before writing every possible piece of code, creating every possible file, or running every possible command,
> you **MUST** first read `SKILLS.md` and check for relevant skills.
> This step is **non-negotiable** and applies to **every possible task** without exception.

**Steps to follow before every possible task:**
1. `view SKILLS.md` — discover every possible available skill
2. `view` every possible skill file that is plausibly relevant to the task
3. Only then proceed with the task

Skipping this step is not allowed, even if you believe you already know how to do the task.
Skills encode environment-specific constraints that override general knowledge.

--JULES STOPGAP DONT EDIT STOP--

# Architecture & Philosophy

This repo IS the published `gm-skill` npm package. The repo root is the package root — no factory, no build step that generates a separate output dir. `skills/gm-skill/SKILL.md` is the ~12-line entry point; every possible phase prose and orchestration logic lives in rs-plugkit and is served on demand via the `instruction` verb.

## WASM-only

The plugkit stack runs as a wasm cdylib loaded by `plugkit-wasm-wrapper.js` under Node/bun. No native binaries are built, downloaded, or published. The wasm artifact is small (<200KB) and ships inside the `gm-skill` npm package; atomic write to disk is sufficient — no kill-before-rename mechanics apply.

## Spool dispatch ABI

Agents dispatch verbs by writing to `.gm/exec-spool/in/<verb>/<N>.txt` (request body) and reading the response from `.gm/exec-spool/out/<verb>-<N>.json` (nested verbs) or `.gm/exec-spool/out/<N>.json` (root verbs). The wasm orchestrator services every possible verb; the harness never executes side effects directly.

**Orchestrator verbs**: `instruction`, `transition`, `phase-status`, `mutable-resolve`, `memorize-fire`, `residual-scan`, `auto-recall`.

**Wasm-direct verbs**: `fs_read`, `fs_write`, `fs_stat`, `fs_readdir`, `kv_get`, `kv_put`, `kv_query`, `fetch`, `exec_js`, `env_get`, `recall`, `codesearch`, `memorize`, `health`, `filter`, `git_status`, `branch_status`, `git_push`.

**git verbs**: `git_status` returns `{dirty, modified, untracked, deleted, staged}` from `git status --porcelain`. `branch_status` returns `{branch, ahead, behind, remote}` — the `remote-pushed` witness. `git_push` is the ONLY admissible push surface — it gates on `git_porcelain()` non-empty (refuses dirty), emits `deviation.push-dirty` on attempt, and shells the push only when clean. A raw `git push` via Bash bypasses the gate and is itself a deviation; ccsniff `--git-discipline` flags it.

**filter verb**: pure stdout → compact-stdout transformation. Body `{kind, input, ...opts}` where kind is one of `grep`, `ls`, `tree`, `json`, `diff`, `git-status`, `log`. Returns `{output, stats:{bytes_in, bytes_out, saved_pct, ...}}`. Pipe raw command output through filter before letting it enter context — rtk's role, in-wasm, no subprocess. Replaces the legacy detached rtk binary download in bootstrap.

## Documentation Policy

Only record non-obvious technical caveats that cost multiple runs to discover. Remove every possible thing that no longer applies. Never document what is already obvious from reading the code.

**No changelog history in AGENTS.md.** Every possible entry is a present-tense rule about what must or must-not be the case in code now. Forbidden: `(FIXED)` markers, commit hashes, dated audit entries, `## Learning audit` sections, "(added 2026-04-DD)" annotations, "we used to X, now we Y" phrasing. Historical framing belongs in `git log` and `CHANGELOG.md`.

**Detail-heavy caveats live in rs-learn (`.gm/rs-learn.db`), not here.** Per-crate runtime quirks, Windows process-spawn mechanics, hook implementation details, ocw/site/workflow specifics, and similar fact-base material are exfiltrated to rs-learn and reachable via `exec:recall`. AGENTS.md keeps only top-level rules that govern gm-the-repo. When in doubt: gm-the-repo architecture or cross-cutting policy stays here; single-crate or single-platform mechanism goes to rs-learn.

## Coding Style

**No comments in code.** No inline, block, or JSDoc comments in every possible location — source, generated output, hooks, scripts.

**Skill SKILL.md files:** Strip explanatory prose. Keep ONLY invocation syntax, transition arrows, gate conditions, constraint lists, and code examples showing exact usage.

**Implicit, not explicit, in skill prose.** Skill files (and prompt-submit.txt) elicit behavior — they do not describe it. Write terse imperative principles whose phrasing triggers the model's already-learned dispositions, not numbered procedures that spell out what to do. Forbidden: "1. agent runs N parallel calls 2. then writes 3. then…", "see paper IV §2.3", "as documented in docs/skills.html", citations to the site or papers, multi-step recipes. The skill is a prompt, not a manual; if it reads like a manual the behavior gets imitated as a script and breaks at the first edge case. The papers and site are *outputs* of the discipline, not *inputs* to it; never link from a skill into the docs. Cross-cutting rules that need a citation belong in this file (AGENTS.md), not in skills.

## Build

There is no build step. The repo root is the published artifact. `npm publish` from root publishes `gm-skill` directly; `package.json` `files:` pins which paths ship.

`AnEntrypoint/gm-skill` is a back-compat repo mirror that receives only `skills/gm-skill/SKILL.md` per release. The canonical install is `bun x skills add AnEntrypoint/gm`.

## the agent is the orchestrator; plugkit is the brain it drives

**The agent orchestrates.** Plugkit is the stateful library the agent drives by dispatching verbs. Plugkit does not act autonomously, does not advance phases in the background, does not validate transitions while the agent waits. Every possible state change is a verb the agent writes into `.gm/exec-spool/in/<verb>/<N>.txt`. If a session shows zero dispatches but the agent narrated a full PLAN→COMPLETE walk, the agent fabricated the walk — plugkit's dispatch ledger is ground truth.

The PLAN → EXECUTE → EMIT → VERIFY → COMPLETE state machine lives natively in rs-plugkit at `rs-plugkit/src/orchestrator/{mod,state,transitions,mutables,memorize}.rs`. Plugkit owns phase tracking, mutables resolution, memorize firing, and transition legality *as data structures and gate checks* — but the agent triggers every possible operation by dispatching one of the orchestrator verbs over the wasm surface (see Spool dispatch ABI above): `transition`, `mutable-resolve`, `memorize-fire`, `phase-status`, `instruction`, `residual-scan`, `auto-recall`. The gm-skill harness routes the agent's verb writes to plugkit; the harness never reimplements the state machine and the agent never expects plugkit to act without a verb. Polling the spool output dir (`sleep && ls`, `Start-Sleep && Test-Path`) instead of reading the response file is the canonical misuse — plugkit is synchronous from the agent's view.

## gm-skill is the canonical universal harness

`skills/gm-skill/SKILL.md` is the single source of truth for harness behavior. It is the only skill shipped — the legacy 15-platform fanout (gm-cc, gm-gc, gm-oc, gm-codex, gm-kilo, gm-qwen, gm-hermes, gm-thebird, gm-vscode, gm-cursor, gm-zed, gm-jetbrains, gm-copilot-cli, gm-antigravity, gm-windsurf) is retired; those downstream repos are archived. Users install gm-skill directly into whatever harness they use.

## Tool surface is plugkit-only

Every possible skill's `allowed-tools:` frontmatter is reduced to `Skill, Read, Write`. `Write` is permitted exclusively for spool dispatch (writing into `.gm/exec-spool/in/<lang>/`). Every possible other side effect — code execution, git, browser, recall, memorize, codesearch — routes through the spool and is serviced by plugkit. The harness never reaches around plugkit; if a capability is missing, add it as a plugkit verb, not as a skill-side tool.

## Core Rules

**Shared memory & search index are tracked, never ignored**: `.gm/rs-learn.db` and `.gm/code-search/` are committed so memory and index state shares across every possible machine, session, and CI run. Tooling, scripts, and every possible agent editing `.gitignore` must NEVER add `.gm/`, `.gm/rs-learn.db`, `.gm/code-search/`, or legacy `.code-search/` to ignore rules. Per the gitignore parent-re-include caveat (re-including a path past an ignored parent dir is impossible), individual `.gm/*` entries (prd-state.json, lastskill, turn-state.json, trajectory-drafts/, ingest-drafts/, rslearn-counter.json) are listed one-by-one between `# >>> gm managed` markers, leaving `.gm/rs-learn.db` and `.gm/code-search/` un-ignored. The gm-managed gitignore entries (written by `gm-plugkit/plugkit-wasm-wrapper.js::ensureGitignored(cwd, entry)`) must not include any of those paths. Every possible project-local persistent state (chunk index, DB, embeddings) must write under `.gm/<name>/`, never to a top-level dotfile/dotdir.

**Disciplines are isolated knowledge stores**: per-project, at `<project>/.gm/disciplines/<name>/{rs-learn.db, code-search/}`. Every possible discipline owns its own rs-learn DB and code-search index. When a `@<name>` sigil is present in the request, isolation is strict — cross-discipline reads are forbidden. Without a sigil, reads (recall/codesearch) fan across `default` plus every possible enabled discipline (one per line in `<project>/.gm/disciplines/enabled.txt`) and merge-rank results with `[discipline:<name>]` prefixes; writes (memorize/ingest/index) without a sigil go to `default` only. Disciplines are tracked in git, never ignored — `ensureGitignored` and any gm-managed gitignore entry must not list `.gm/disciplines` or any subpath. The gm-skill harness and every possible spool verb propagate the `@<name>` sigil verbatim through their dispatch chain.

**Nothing fake in source the user runs**: every possible stub, mock, placeholder return, fixture-only path, demo-mode short-circuit, and "TODO: implement" body is forbidden in shipped code. Scaffolds and shims are permitted only when they delegate to real behavior (real upstream API, real subprocess, real disk). Before adding a shim, check whether a published library or tool already provides that surface — maintaining a local reimplementation of an upstream solution drifts and ages. Detection is behavioral, not by keyword: code that always succeeds, returns the same value regardless of input, or short-circuits a real call to satisfy a type signature is a stub. Acceptance is real input through real code into real output, witnessed; every possible degradation from that leaves the mutable open.

**Spool dispatch gates**: `lib/spool-dispatch.js` implements marker-file gate logic that controls tool use, writes, and git operations. `checkDispatchGates(sessionId, operation)` reads marker files (`.gm/prd.yml`, `.gm/mutables.yml`, `.gm/needs-gm`, `.gm/gm-fired-<id>`) and returns `{allowed: bool, reason: string}`. Gates are checked at the CLI/bootstrap layer before tools execute. Tool denials via gate checks report the reason text to the model so it can adjust behavior (e.g., resolve mutables before retrying). Gate denials never mutate command arguments — they surface policy as imperative instruction via reason string.

**Done is plugkit's pronouncement, never the agent's claim**: the chain is COMPLETE only when `transition to=COMPLETE` returns COMPLETE phase and plugkit's on-disk state file reflects it. "I think we're done" is not done. "The user seems satisfied" is not done. The COMPLETE gate (gates.rs) is the single arbiter — it refuses on PRD-open, mutables-unresolved, dirty worktree, or missing residual-scan marker. The agent's job is to drive the chain into a state where the gate allows, then dispatch the verb, then read the response. Every possible alternative is narration.

**Every residual is triaged this turn, never named-and-deferred**: every entry in `git status --porcelain` at residual-scan or COMPLETE-attempt is the agent's responsibility to triage now. Triage = decide one of (a) commit (real session work or real upstream artifact landed in this tree), (b) add to the managed gitignore block (transient runtime emission, e.g., `.gm/witness/`, `.gm/exec-spool/.*-stale.json`), (c) revert (accidental or stale junk). The label "pre-existing residual" is NOT a stop excuse — it is the *outcome* of triage decision (a) when work is real, or (c) when junk. Name-and-stop with `blockedBy: external` is admissible *only* when triage requires external authority that this session cannot reach (another team's repo, hardware credential, owner-only decision visible to no one in-process). For local-tree residuals the agent always has authority and triages this turn; declaring "pre-existing, can't touch" on local files is the canonical drift mechanism that wedges the chain at VERIFY. Disciplines (`.gm/disciplines/`) are tracked, never ignored — new memorize-fire mem-*.json files are committed, not gitignored. The managed gitignore block (between `# >>> plugkit managed` markers) carries only runtime artifacts that have no future read value (witness JSON, transient staleness markers, lock files).

**"Every possible" is the load-bearing test, applied to every noun the request names**: PLAN-phase PRD construction is exhaustive, not minimal. The phrase "every possible" is how the agent thickens the cover — every possible task, every possible validation, every possible mutable, every possible corner case, every possible caveat, every possible failure mode, every possible interaction, every possible empty/overflow/reentry state, every possible degenerate input — each application of the phrase produces PRD rows. A non-trivial request that yields a single-digit PRD has not finished enumerating; the closure is still in the agent's head, not in plugkit's store, and the chain will converge on a thin slice that leaves silent residuals. After the first PRD pass, the existing list becomes input to a second transform — for each row, the agent asks what every possible corner case looks like, and writes those as additional rows. The expansion is closed when applying "every possible" to the current list yields nothing new — not when the agent feels done. Validations, edge cases, and anticipated mutables are first-class PRD rows, never implicit. Long-horizon requests routinely produce PRDs in the high tens or hundreds; the row count is the resolution of the cover, and resolution is what the user asked for when they handed over a long-horizon prompt. Sparse PRDs under-specify the closure and orphan the work; dense PRDs make completion observable.

**Noticing is a planning event — at every phase, in every dispatch window**: any observation the agent makes during the chain — anything that should be done, anything outstanding, anything unfinished, anything improvable, anything misaligned with user preferences, anything the work itself surfaces about what *else* the work touches — is a `prd-add` the agent dispatches this turn. Observations carried in the response body without conversion to a PRD row evaporate when the turn ends; only the PRD store survives. The default response to noticing is to convert. The discovery surface keeps producing new in-scope items as the chain walks PLAN→EXECUTE→EMIT→VERIFY — every phase has its own noticing-to-PRD pressure. Skipping the conversion ("I'll mention it in the summary" / "future work" / "note for later") is the canonical drift mechanism: the observation does not persist, the future turn does not arrive, the residual goes silent. Density grows along the walk, not just at PLAN-time; a chain that exits PLAN with N rows and reaches COMPLETE with N rows has either had no real discoveries (unlikely on a non-trivial task) or has lost them. When the discovery is structural rather than concrete — "the project would benefit from X", "this surface has no test coverage", "the docs do not mention Y", "the agent's preference for Z is being violated here" — it is still a PRD row, written with the witness that motivated it. Preference-aware noticing applies the same conversion: when the agent observes that current state diverges from user-stated preferences (dense PRDs, residual-triage, no name-and-defer, every-possible expansion, browser-witness coverage, push-on-clean), each divergence is a `prd-add` describing what the aligned state looks like.

**A turn without a tool call is a stop; summary is a stop; both are forbidden until plugkit pronounces COMPLETE**: every programming agent — regardless of vendor — reads only tool calls and their outputs, so an assistant message that ends in prose with no tool call IS the turn ending and the session halts there. This is the mechanical root of the "agent did one small piece and stopped" failure: the model wrote a wrap-up paragraph, emitted no tool call, and the harness read that as done. The rule is therefore absolute and tool-agnostic: while the chain is in-flight (phase ≠ COMPLETE OR prd_pending_count > 0) the agent NEVER ends a turn in prose and NEVER writes a summary/recap/"what I did" closure — every turn terminates in a tool call that advances the chain (`instruction`, the next named verb, `transition`, `phase-status`). The only event that authorizes a prose-only turn is plugkit returning `phase=COMPLETE` AND `prd_pending_count=0`; the agent's own sense that "the work feels done" authorizes nothing. Before any apparent stop or any summary, the agent dispatches `phase-status` and rechecks — a non-terminal phase means the urge to stop was drift, and the recovery is to dispatch `instruction` and continue. This depends on nothing but the verb spool, so it holds on every agent with no hook and no tool-specific feature; any continuation mechanism that relies on a hook or a single tool's behavior is non-portable and must be replaced by this spool-only discipline.

**Always seek the next state transition**: if the chain is not COMPLETE, there is a next move. Idle mid-chain is a deviation. The agent who finishes a verb and stops without dispatching the next instruction has stopped walking the chain. `phase-status` tells you where you are; `instruction` tells you what's next. There is no "I'll wait for the user" mid-chain — the user authorized closure at request time, not phase-by-phase.

**Return to plugkit on every possible drift**: `instruction` is the recovery primitive. Against every possible stall, gate-denial, unexpected error, or moment of uncertainty about the next step, the response is always to dispatch `instruction` and read the prose — never to improvise. The verb is synchronous, cheap, idempotent; over-dispatching it has no cost, under-dispatching it is the canonical drift mechanism. A session that goes >N tool calls without an instruction dispatch in a non-trivial phase is hallucinating its own chain. Every possible gate denial names the next verb in its `reason` field — the agent reads the field and dispatches the named verb, never argues around the denial.

**Push is part of COMPLETE, never optional, never asked**: every possible session that mutates tracked files ends with commit + push to origin. Asking the user "do you want me to push?" is a deviation — the push IS the validation dispatch (`verify.rs`: "The push you make IS the validation dispatch"). The chain is not COMPLETE until the remote reflects HEAD. ccsniff `--git-discipline` and a pending `deviation.complete-without-push` event flag sessions that close without pushing.

**Push requires clean worktree witnessed in its own tool-use event**: `git push` is admissible only when `git status --porcelain` returns empty, and the porcelain probe must be its own Bash tool-use event before the push — a separate `Bash(...)` call, not a `&&`-chained shell command within the push event. ccsniff `--git-discipline` scans the last 20 Bash **tool-use events** (not shell commands inside those events) for an explicit porcelain probe; `add && commit && push` in one Bash call counts as one event with no porcelain witness even when the worktree is clean by construction. A push from a dirty tree orphans the unstaged delta and breaks the next session's first read. Enforced in `lib/spool-dispatch.js::checkDispatchGates(sessionId, 'git', {...})` which runs the porcelain probe via `spawnSync('git', ['status', '--porcelain'])` and refuses dirty trees; the rs-plugkit `gates.rs` COMPLETE branch enforces the same invariant for the transition-to-COMPLETE path; instruction prose (`verify.rs`, `update_docs.rs`) restates it imperatively; `residual.rs` skips the scan when dirty so the four-observation window cannot be claimed past an unwitnessed delta. ccsniff `--git-discipline` flags the deviation post-hoc — true positives now that ccsniff 1.1.8+ strips quoted commit-message bodies before regex match.

**memorize dispatch manages CLAUDE.md / AGENTS.md**: Do not inline-edit. Dispatch via spool: write `.gm/exec-spool/in/memorize/<N>.txt` with the fact text; the wasm orchestrator embeds and persists it. Classifier rejects changelog-shaped facts from AGENTS.md ingestion (rs-learn store still accepts them).

**Behavioral discipline lives in plugkit's `instruction` verb** — Three-Layer Admission Filter (L1 cost, L2 bounds, L3 direction), maturity-first emit, response-not-mutation-surface, structural recognition of closure anti-shapes, code invariants (state-space minimization, hardware-reality, flat-structure, vertical-slice, async-boundary, naming-by-scale, fail-fast, binary-transport, single-focus). Dispatch `instruction` for the live prose; do not duplicate it here.

**host_exec_js is synchronous**: wasm host runs `exec_js` via Node `child_process.spawnSync`; long subprocesses block the watcher. Pass a real per-call timeout; orphaned background work unsupported under wasm.

**Sync-before-emit (codeinsight + search)**: outputs must come from freshly-completed indices. Cache serves only on digest match (mtime sum + git HEAD + dirty-tree marker). Default invocation runs fresh. `--read-cache` permitted only when `.codeinsight.digest` matches; mismatch auto-refreshes. rs-search runs scan + embed + sweep before first result; emits `[index fully synced: …]`. Unverified-index emit = stale ground truth.

**Auto-recall on turn entry**: the `instruction` verb attaches an `auto_recall` pack `{query, hits, fired_at, turn_entry:true}` to its response on the first dispatch after a >30s idle gap or session-start. Query is derived from `.gm/last-prompt.txt` / `.gm/turn-state.json`; hits are the top recall results plugkit pulled before serving the instruction. Wasm-side `wasm_hooks::prompt_submit` exports exist for legacy hook-host integration but the current spool watcher does not invoke them — orientation comes through the instruction verb's response pack instead.

**Skill SKILL.md frontmatter `allowed-tools:` is harness-enforced**: If a skill omits `allowed-tools` or does not list `Skill`, the model loses the ability to invoke downstream skills that turn. The shipped surface is a single skill (`gm-skill`); this rule governs every possible future skill that participates in a chain.

**rs-learn observability**: every possible learning-pipeline state change emits a structured `evt: {event, sess, ts, ...}` line via `wasm_dispatch::emit_event` (host_log level 1) into `.gm/exec-spool/.watcher.log` and gm-log/<date>/plugkit.jsonl. Event taxonomy: `embed_fail` (step + error), `embed_init_ok/fail/cached_fail`, `memorize_reject` (reason, text_prefix, namespace), `memorize_embed_rollback` (key, namespace, error), `discipline_sigil_ignored` (sigil in @<name> request routed to default), `table_dropped` (dim-mismatch silent drops), `recall_score_unavailable` (host_vec_search strips score). Recall replies now include `mode` (vector_top_k|fallback_like|kv_query), `namespace`, `derived_query`, and per-hit `score` (null when host elides). gmsniff flags: `--embed-failures`, `--recall-misses`, `--recall-scores`, `--classifier-rejects`, `--memory-leverage`, `--recall-modes`, `--table-drops`, `--discipline-sigil-ignored`. ccsniff `--learning-xref` joins transcript turn windows to rs_learn events by sess (now stamped) + project + time-window. Learning quality is observable, not algorithmic black box.

**SKILL.md auto-refresh**: every possible bootstrap call (`bootstrapPlugkit`) compares the sha256 of the bundled `gm-skill/skills/gm-skill/SKILL.md` (shipped inside the npm package) against the installed copies at `~/.agents/skills/gm-skill/SKILL.md` and `~/.claude/skills/gm-skill/SKILL.md`. Hash mismatch triggers atomic write (`.tmp` + rename) of both targets so the agent sees the latest prose on next session — no manual reinstall needed. Logged to `bootstrap.jsonl` as `SKILL.md refreshed`. The bundled SKILL.md is the source of truth; reinstalling gm-skill only matters when the npm package itself changes, which the cascade pipeline guarantees on every possible plugkit version bump.

**Skill-initiated bootstrap contract**: `lib/skill-bootstrap.js` performs wasm initialization for skill-driven dispatch without hook infrastructure. `bootstrapPlugkit(sessionId)` accepts optional SESSION_ID, ensures the wasm artifact and `plugkit-wasm-wrapper.js` are in place, writes status/error to `.gm/exec-spool/.bootstrap-status.json` and `.bootstrap-error.json` for spool awareness, and returns `{ ok: true }` on success or `{ ok: false, error: message }` on failure. Failures are non-fatal — callers fall back to a degraded surface.

## Cascade pipeline

Push to every possible rs-* sibling repo (rs-exec, rs-search, rs-codeinsight, rs-learn) triggers `cascade.yml` which uses `gh workflow run` to invoke rs-plugkit's `release.yml` via PUBLISHER_TOKEN. rs-plugkit cargo-pulls the latest sibling crate revs at build time and emits a single `plugkit.wasm` artifact (no per-sibling npm wasm packages — that pattern was retired). Publishes to `plugkit-bin` Releases + npm `plugkit-wasm`, then auto-bumps `gm.json::plugkitVersion` and `bin/plugkit.wasm.sha256` in this repo. The version bump commit on this repo triggers `publish.yml`, which (a) `npm publish`es `gm-skill` from the repo root, (b) `npm publish`es `gm-plugkit` from `gm-plugkit/`, and (c) force-pushes `skills/gm-skill/SKILL.md` to the `AnEntrypoint/gm-skill` back-compat mirror repo.

Three npm packages publish from this repo: `gm-skill` (the skill harness), `gm-plugkit` (bootstrap + watcher), `plugkit-wasm` (wasm binary). publish.yml + the rs-plugkit cascade ships all three on every version-bump commit. The legacy 15 downstream repos (gm-cc, gm-gc, gm-oc, gm-kilo, gm-codex, gm-qwen, gm-copilot-cli, gm-hermes, gm-thebird, gm-vscode, gm-cursor, gm-zed, gm-jetbrains, gm-antigravity, gm-windsurf) are archived on GitHub — no further releases, no orphan-commit publish step.

**Repos involved (push to every possible one triggers cascade):**
- `AnEntrypoint/rs-exec` — exec runner, browser sessions, idle cleanup, session task isolation
- `AnEntrypoint/rs-codeinsight` — code search backend, symbol indexing
- `AnEntrypoint/rs-search` — file search backend, embedding and sweep
- `AnEntrypoint/rs-plugkit` — CLI entry point, spool watcher dispatcher; version source of truth in `Cargo.toml`
- `AnEntrypoint/rs-learn` — memory backend, recall/ingest via HTTP RPC
- `AnEntrypoint/gm` — `gm.json` holds `plugkitVersion`; CI publishes the single `gm-skill` npm package

**To update every possible thing**: push to the relevant repo. No manual version bumps, no local cargo builds. Never run `cargo update` or `cargo build` locally — push and let CI build.

**PUBLISHER_TOKEN required** in `rs-exec`, `rs-codeinsight`, `rs-search` for cascade.yml to trigger rs-plugkit. Set with: `gh secret set PUBLISHER_TOKEN --repo AnEntrypoint/<repo>`.

**Timeout enforcement**: every possible `exec_js` dispatch carries a positive `timeoutMs`. The host treats missing or zero as a hard error.

## Spool-dispatch architecture replaces hooks

Orchestration state is tracked via marker files in `.gm/` instead of hook events. `SpoolDispatcher` reads these markers via `checkDispatchGates(sessionId, operation)` and gates tool use, writes, and git operations:

**Marker files**: `.gm/prd.yml` (existence triggers needs-gm gate), `.gm/mutables.yml` (every possible unresolved entry blocks Write/Edit/git), `.gm/needs-gm` (written by bootstrap, read by dispatcher), `.gm/gm-fired-<sessionId>` (written by gm skill/agent, cleared at turn start), `.gm/residual-check-fired` (ensures one-shot residual-scan per stop window).

**Gate enforcement**: CLI layer (plugkit, rs-exec, downstream platforms) calls `checkDispatchGates()` before tool execution. On denial, reason text surfaces to the model. Bootstrap (lib/skill-bootstrap.js) handles daemon initialization and marker setup. Marker-driven dispatch replaces hook event pump entirely — no session event callbacks needed.

**gm-skill tool-use sequencing**: Invoking `Skill(skill="gm-skill")` writes `.gm/gm-fired-<sessionId>` to clear the needs-gm gate. The marker is cleared at turn start to reset the gate. There is one shipped skill; no subagent variant exists.

**Session lifecycle**: Session-end kills background tasks via `killSessionTasks` RPC on real-exit reasons (clear/logout/prompt_input_exit). Every possible browser session and background task persists across turn-stops — cleanup happens exclusively on real-exit reasons. Residual-scan fires when PRD is empty/missing AND no open browser sessions AND no running tasks; agent either expands PRD with in-spirit residuals or explicitly states none.

## Spool observability surface

Every possible agent has a one-shot system-state probe: dispatch `plugkit health` via the file-spool (write `.gm/exec-spool/in/health/<N>.txt` empty body, read `out/<N>.json`). Returns plugkit version + pin-match, watcher liveness, runner state, rs-learn status, cache dirs, inbox/outbox counts, recent hook fires, recent errors. Use before assuming every possible component is broken.

Three persistent diagnostic files at `.gm/exec-spool/` root are updated by the running stack (not the agent): `.status.json` (watcher state each tick; stale mtime = dead watcher), `.last-session-start.json` (most recent session-start spawn result), `.bootstrap-error.json` (pin-mismatch / fetch-fail surface — absent = healthy). Reading these directly via Read is allowed (runtime data exception); spool dispatch isn't needed to inspect them.

## Site Build & Documentation

**Mermaid integration**: `theme.mjs` (articleClient + landingClient) dynamic-imports mermaid from cdn.jsdelivr.net after `applyDiff` and calls `mermaid.run()` on `.mermaid` blocks. `startOnLoad` must be false—the parse happens before article injection, so `startOnLoad` would miss injected blocks. Theme auto-detects color scheme via `prefers-color-scheme`.

**Navigation**: `site/content/globals/navigation.yaml` uses grouped entry format—each item is either `{label, href}` (single link) or `{label, group: [{label, href}, ...]}` (dropdown menu). Dropdowns render via `<details>/<summary>` through the flatspace `C.Topbar` primitive invoked in `site/theme.mjs`; no JS required. In-page topbars in docs/paper*.html et al. render directly on file open and must be kept in sync with the same markup.

**Landing page renderer**: the deployed `/` route on https://anentrypoint.github.io/gm/ is rendered by `site/theme.mjs` from `site/content/pages/home.yaml` via flatspace. `site/index.html` + `site/main.js` build `docs/bundle.js` for non-flatspace standalone preview only. Landing edits go through `site/theme.mjs` (Hero) and `site/content/pages/home.yaml` (content), never `site/index.html`.

**docs/styles.css is generated**: regenerated from `site/input.css` by `site/package.json` build script (copies input.css → docs/styles.css after esbuild). Direct edits to docs/styles.css are wiped on next build — append to site/input.css instead.

## Made with gm Page

`docs/made-with.html` is a static showcase of notable AnEntrypoint projects. Update the PROJECTS array when a new notable project is added — projects with interesting descriptions, meaningful star counts, or technically unusual scope. Static data, no runtime API calls. Standalone HTML, not bundled.


@.gm/next-step.md
