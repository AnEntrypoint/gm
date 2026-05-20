# AGENTS.md

--JULES STOPGAP DONT EDIT START--

## Skills

This project has task-specific skills available.

> **MANDATORY:** Before writing any code, creating any file, or running any command,
> you **MUST** first read `SKILLS.md` and check for relevant skills.
> This step is **non-negotiable** and applies to **every task** without exception.

**Steps to follow before any task:**
1. `view SKILLS.md` — discover all available skills
2. `view` every skill file that is plausibly relevant to the task
3. Only then proceed with the task

Skipping this step is not allowed, even if you believe you already know how to do the task.
Skills encode environment-specific constraints that override general knowledge.

--JULES STOPGAP DONT EDIT STOP--

# Architecture & Philosophy

gm generates a single skill package (`gm-skill`) from a convention-driven source. The skill is a ~12-line entry point; all phase prose and orchestration logic live in rs-plugkit and are served on demand via the `instruction` verb.

## WASM-only

The plugkit stack runs as a wasm cdylib loaded by `plugkit-wasm-wrapper.js` under Node/bun. No native binaries are built, downloaded, or published. The wasm artifact is small (<200KB) and ships inside the `gm-skill` npm package; atomic write to disk is sufficient — no kill-before-rename mechanics apply.

## Spool dispatch ABI

Agents dispatch verbs by writing to `.gm/exec-spool/in/<verb>/<N>.txt` (request body) and reading the response from `.gm/exec-spool/out/<verb>-<N>.json` (nested verbs) or `.gm/exec-spool/out/<N>.json` (root verbs). The wasm orchestrator services every verb; the harness never executes side effects directly.

**Orchestrator verbs**: `instruction`, `transition`, `phase-status`, `mutable-resolve`, `memorize-fire`, `residual-scan`, `auto-recall`.

**Wasm-direct verbs**: `fs_read`, `fs_write`, `fs_stat`, `fs_readdir`, `kv_get`, `kv_put`, `kv_query`, `fetch`, `exec_js`, `env_get`, `recall`, `codesearch`, `memorize`, `health`, `filter`.

**filter verb**: pure stdout → compact-stdout transformation. Body `{kind, input, ...opts}` where kind is one of `grep`, `ls`, `tree`, `json`, `diff`, `git-status`, `log`. Returns `{output, stats:{bytes_in, bytes_out, saved_pct, ...}}`. Pipe raw command output through filter before letting it enter context — rtk's role, in-wasm, no subprocess. Replaces the legacy detached rtk binary download in bootstrap.

## Documentation Policy

Only record non-obvious technical caveats that cost multiple runs to discover. Remove anything that no longer applies. Never document what is already obvious from reading the code.

**No changelog history in AGENTS.md.** Every entry is a present-tense rule about what must or must-not be the case in code now. Forbidden: `(FIXED)` markers, commit hashes, dated audit entries, `## Learning audit` sections, "(added 2026-04-DD)" annotations, "we used to X, now we Y" phrasing. Historical framing belongs in `git log` and `CHANGELOG.md`.

**Detail-heavy caveats live in rs-learn (`.gm/rs-learn.db`), not here.** Per-crate runtime quirks, Windows process-spawn mechanics, hook implementation details, ocw/site/workflow specifics, and similar fact-base material are exfiltrated to rs-learn and reachable via `exec:recall`. AGENTS.md keeps only top-level rules that govern gm-the-repo. When in doubt: gm-the-repo architecture or cross-cutting policy stays here; single-crate or single-platform mechanism goes to rs-learn.

## Coding Style

**No comments in code.** No inline, block, or JSDoc comments anywhere — source, generated output, hooks, scripts.

**Skill SKILL.md files:** Strip explanatory prose. Keep ONLY invocation syntax, transition arrows, gate conditions, constraint lists, and code examples showing exact usage.

**Implicit, not explicit, in skill prose.** Skill files (and prompt-submit.txt) elicit behavior — they do not describe it. Write terse imperative principles whose phrasing triggers the model's already-learned dispositions, not numbered procedures that spell out what to do. Forbidden: "1. agent runs N parallel calls 2. then writes 3. then…", "see paper IV §2.3", "as documented in docs/skills.html", citations to the site or papers, multi-step recipes. The skill is a prompt, not a manual; if it reads like a manual the behavior gets imitated as a script and breaks at the first edge case. The papers and site are *outputs* of the discipline, not *inputs* to it; never link from a skill into the docs. Cross-cutting rules that need a citation belong in this file (AGENTS.md), not in skills.

## Build

```
node cli.js gm-starter ./build
```

Single output: `build/gm-skill/` — the canonical universal harness. Published to npm as `gm-skill`.

## the agent is the orchestrator; plugkit is the brain it drives

**The agent orchestrates.** Plugkit is the stateful library the agent drives by dispatching verbs. Plugkit does not act autonomously, does not advance phases in the background, does not validate transitions while the agent waits. Every state change is a verb the agent writes into `.gm/exec-spool/in/<verb>/<N>.txt`. If a session shows zero dispatches but the agent narrated a full PLAN→COMPLETE walk, the agent fabricated the walk — plugkit's dispatch ledger is ground truth.

The PLAN → EXECUTE → EMIT → VERIFY → COMPLETE state machine lives natively in rs-plugkit at `rs-plugkit/src/orchestrator/{mod,state,transitions,mutables,memorize}.rs`. Plugkit owns phase tracking, mutables resolution, memorize firing, and transition legality *as data structures and gate checks* — but the agent triggers every operation by dispatching one of the orchestrator verbs over the wasm surface (see Spool dispatch ABI above): `transition`, `mutable-resolve`, `memorize-fire`, `phase-status`, `instruction`, `residual-scan`, `auto-recall`. The gm-skill harness routes the agent's verb writes to plugkit; the harness never reimplements the state machine and the agent never expects plugkit to act without a verb. Polling the spool output dir (`sleep && ls`, `Start-Sleep && Test-Path`) instead of reading the response file is the canonical misuse — plugkit is synchronous from the agent's view.

## gm-skill is the canonical universal harness

`gm-starter/skills/gm-skill/SKILL.md` is the single source of truth for harness behavior. It is the only skill shipped — the legacy 15-platform fanout (gm-cc, gm-gc, gm-oc, gm-codex, gm-kilo, gm-qwen, gm-hermes, gm-thebird, gm-vscode, gm-cursor, gm-zed, gm-jetbrains, gm-copilot-cli, gm-antigravity, gm-windsurf) is retired; those downstream repos are archived. Users install gm-skill directly into whatever harness they use.

## Tool surface is plugkit-only

Every skill's `allowed-tools:` frontmatter is reduced to `Skill, Read, Write`. `Write` is permitted exclusively for spool dispatch (writing into `.gm/exec-spool/in/<lang>/`). All other side effects — code execution, git, browser, recall, memorize, codesearch — route through the spool and are serviced by plugkit. The harness never reaches around plugkit; if a capability is missing, add it as a plugkit verb, not as a skill-side tool.

## Core Rules

**Shared memory & search index are tracked, never ignored**: `.gm/rs-learn.db` and `.gm/code-search/` are committed so memory and index state shares across machines, sessions, and CI. Tooling, scripts, and any agent editing `.gitignore` must NEVER add `.gm/`, `.gm/rs-learn.db`, `.gm/code-search/`, or legacy `.code-search/` to ignore rules. Per the gitignore parent-re-include caveat (re-including a path past an ignored parent dir is impossible), individual `.gm/*` entries (prd-state.json, lastskill, turn-state.json, trajectory-drafts/, ingest-drafts/, rslearn-counter.json) are listed one-by-one between `# >>> gm managed` markers, leaving `.gm/rs-learn.db` and `.gm/code-search/` un-ignored. Same rule for downstream repos: `lib/template-builder.js::generateGitignore()` must not emit any of those paths. Any project-local persistent state (chunk index, DB, embeddings) must write under `.gm/<name>/`, never to a top-level dotfile/dotdir.

**Disciplines are isolated knowledge stores**: per-project, at `<project>/.gm/disciplines/<name>/{rs-learn.db, code-search/}`. Each discipline owns its own rs-learn DB and code-search index. When a `@<name>` sigil is present in the request, isolation is strict — cross-discipline reads are forbidden. Without a sigil, reads (recall/codesearch) fan across `default` plus every enabled discipline (one per line in `<project>/.gm/disciplines/enabled.txt`) and merge-rank results with `[discipline:<name>]` prefixes; writes (memorize/ingest/index) without a sigil go to `default` only. Disciplines are tracked in git, never ignored — `lib/template-builder.js::generateGitignore()` and the gm-managed gitignore markers in downstream repos must not list `.gm/disciplines` or any subpath. The gm-skill harness and every spool verb propagate the `@<name>` sigil verbatim through their dispatch chain.

**Clean build required**: `cleanBuildDir()` must delete the entire output dir before regenerating. Skipping causes stale files to silently shadow new ones.

**Nothing fake in source the user runs**: stubs, mocks, placeholder returns, fixture-only paths, demo-mode short-circuits, and "TODO: implement" bodies are forbidden in shipped code. Scaffolds and shims are permitted only when they delegate to real behavior (real upstream API, real subprocess, real disk). Before adding a shim, check whether a published library or tool already provides that surface — maintaining a local reimplementation of an upstream solution drifts and ages. Detection is behavioral, not by keyword: code that always succeeds, returns the same value regardless of input, or short-circuits a real call to satisfy a type signature is a stub. Acceptance is real input through real code into real output, witnessed; anything less leaves the mutable open.

**Spool dispatch gates**: `lib/spool-dispatch.js` implements marker-file gate logic that controls tool use, writes, and git operations. `checkDispatchGates(sessionId, operation)` reads marker files (`.gm/prd.yml`, `.gm/mutables.yml`, `.gm/needs-gm`, `.gm/gm-fired-<id>`) and returns `{allowed: bool, reason: string}`. Gates are checked at the CLI/bootstrap layer before tools execute. Tool denials via gate checks report the reason text to the model so it can adjust behavior (e.g., resolve mutables before retrying). Gate denials never mutate command arguments — they surface policy as imperative instruction via reason string.

**memorize dispatch manages CLAUDE.md / AGENTS.md**: Do not inline-edit. Dispatch via spool: write `.gm/exec-spool/in/memorize/<N>.txt` with the fact text; the wasm orchestrator embeds and persists it. Classifier rejects changelog-shaped facts from AGENTS.md ingestion (rs-learn store still accepts them).

**Behavioral discipline lives in plugkit's `instruction` verb** — Three-Layer Admission Filter (L1 cost, L2 bounds, L3 direction), maturity-first emit, response-not-mutation-surface, structural recognition of closure anti-shapes, code invariants (state-space minimization, hardware-reality, flat-structure, vertical-slice, async-boundary, naming-by-scale, fail-fast, binary-transport, single-focus). Dispatch `instruction` for the live prose; do not duplicate it here.

**host_exec_js is synchronous**: wasm host runs `exec_js` via Node `child_process.spawnSync`; long subprocesses block the watcher. Pass a real per-call timeout; orphaned background work unsupported under wasm.

**Sync-before-emit (codeinsight + search)**: outputs must come from freshly-completed indices. Cache serves only on digest match (mtime sum + git HEAD + dirty-tree marker). Default invocation runs fresh. `--read-cache` permitted only when `.codeinsight.digest` matches; mismatch auto-refreshes. rs-search runs scan + embed + sweep before first result; emits `[index fully synced: …]`. Unverified-index emit = stale ground truth.

**Auto-recall on prompt-submit**: rs-plugkit prompt-submit hook derives 2-6 word recall query from user prompt, calls rs-learn `Searcher` directly via shared tokio Runtime, injects "## Recall for this prompt" into systemMessage. Session-start auto-search (codeinsight) + every-prompt auto-recall ensure every turn begins with prior memory loaded.

**Skill SKILL.md frontmatter `allowed-tools:` is harness-enforced**: If a skill omits `allowed-tools` or does not list `Skill`, the model loses the ability to invoke downstream skills that turn. The shipped surface is a single skill (`gm-skill`); this rule governs any future skill that participates in a chain.

**Skill-initiated bootstrap contract**: `gm-starter/lib/skill-bootstrap.js` performs wasm initialization for skill-driven dispatch without hook infrastructure. `bootstrapPlugkit(sessionId)` accepts optional SESSION_ID, ensures the wasm artifact and `plugkit-wasm-wrapper.js` are in place, writes status/error to `.gm/exec-spool/.bootstrap-status.json` and `.bootstrap-error.json` for spool awareness, and returns `{ ok: true }` on success or `{ ok: false, error: message }` on failure. Failures are non-fatal — callers fall back to a degraded surface.

## Cascade pipeline

Push to any rs-* sibling repo (rs-exec, rs-search, rs-codeinsight, rs-learn) triggers `cascade.yml` which uses `gh workflow run` to invoke rs-plugkit's `release.yml` via PUBLISHER_TOKEN. rs-plugkit rebuilds its own wasm, publishes to `plugkit-bin` Releases + npm `plugkit-wasm`, then auto-bumps `gm-starter/gm.json::plugkitVersion` and `bin/plugkit.wasm.sha256` in this repo. The cascade does NOT rebuild rs-plugkit using rs-* sibling Cargo source — siblings publish their own wasm artifacts independently (`@anentrypoint/rs-learn-wasm`, `@anentrypoint/rs-codeinsight-wasm`). The version bump commit on this repo triggers `publish.yml`, which runs `node cli.js gm-starter ./build` and `npm publish build/gm-skill`.

There is one published artifact: the `gm-skill` npm package. The legacy 15 downstream repos (gm-cc, gm-gc, gm-oc, gm-kilo, gm-codex, gm-qwen, gm-copilot-cli, gm-hermes, gm-thebird, gm-vscode, gm-cursor, gm-zed, gm-jetbrains, gm-antigravity, gm-windsurf) are archived on GitHub — no further releases, no orphan-commit publish step.

**acptoapi is the upstream embedding/LLM proxy**: reachable at 127.0.0.1:4800. `bootstrapAcptoapi` (in `lib/daemon-bootstrap.js`) spawns `bun x acptoapi@latest` if the port is unreachable. The wasm host's `vec_embed` and `fetch` verbs route through it. Spawn failure is non-fatal — callers degrade.

**Repos involved (push to any triggers cascade):**
- `AnEntrypoint/rs-exec` — exec runner, browser sessions, idle cleanup, session task isolation
- `AnEntrypoint/rs-codeinsight` — code search backend, symbol indexing
- `AnEntrypoint/rs-search` — file search backend, embedding and sweep
- `AnEntrypoint/rs-plugkit` — CLI entry point, spool watcher dispatcher; version source of truth in `Cargo.toml`
- `AnEntrypoint/rs-learn` — memory backend, recall/ingest via HTTP RPC
- `AnEntrypoint/gm` — `gm-starter/gm.json` holds `plugkitVersion`; CI publishes the single `gm-skill` npm package

**To update anything**: push to the relevant repo. No manual version bumps, no local cargo builds. Never run `cargo update` or `cargo build` locally — push and let CI build.

**PUBLISHER_TOKEN required** in `rs-exec`, `rs-codeinsight`, `rs-search` for cascade.yml to trigger rs-plugkit. Set with: `gh secret set PUBLISHER_TOKEN --repo AnEntrypoint/<repo>`.

**Timeout enforcement**: every `exec_js` dispatch carries a positive `timeoutMs`. The host treats missing or zero as a hard error.

## Spool-dispatch architecture replaces hooks

Orchestration state is tracked via marker files in `.gm/` instead of hook events. `SpoolDispatcher` reads these markers via `checkDispatchGates(sessionId, operation)` and gates tool use, writes, and git operations:

**Marker files**: `.gm/prd.yml` (existence triggers needs-gm gate), `.gm/mutables.yml` (unresolved entries block Write/Edit/git), `.gm/needs-gm` (written by bootstrap, read by dispatcher), `.gm/gm-fired-<sessionId>` (written by gm skill/agent, cleared at turn start), `.gm/residual-check-fired` (ensures one-shot residual-scan per stop window).

**Gate enforcement**: CLI layer (plugkit, rs-exec, downstream platforms) calls `checkDispatchGates()` before tool execution. On denial, reason text surfaces to the model. Bootstrap (gm-starter/lib/skill-bootstrap.js) handles daemon initialization and marker setup. Marker-driven dispatch replaces hook event pump entirely — no session event callbacks needed.

**gm-skill tool-use sequencing**: Invoking `Skill(skill="gm-skill")` writes `.gm/gm-fired-<sessionId>` to clear the needs-gm gate. The marker is cleared at turn start to reset the gate. There is one shipped skill; no subagent variant exists.

**Session lifecycle**: Session-end kills background tasks via `killSessionTasks` RPC on real-exit reasons (clear/logout/prompt_input_exit). Browser sessions and background tasks persist across turn-stops — cleanup happens exclusively on real-exit reasons. Residual-scan fires when PRD is empty/missing AND no open browser sessions AND no running tasks; agent either expands PRD with in-spirit residuals or explicitly states none.

## Spool observability surface

Every agent has a one-shot system-state probe: dispatch `plugkit health` via the file-spool (write `.gm/exec-spool/in/health/<N>.txt` empty body, read `out/<N>.json`). Returns plugkit version + pin-match, watcher liveness, runner state, rs-learn status, cache dirs, inbox/outbox counts, recent hook fires, recent errors. Use before assuming any component is broken.

Three persistent diagnostic files at `.gm/exec-spool/` root are updated by the running stack (not the agent): `.status.json` (watcher state each tick; stale mtime = dead watcher), `.last-session-start.json` (most recent session-start spawn result), `.bootstrap-error.json` (pin-mismatch / fetch-fail surface — absent = healthy). Reading these directly via Read is allowed (runtime data exception); spool dispatch isn't needed to inspect them.

## Site Build & Documentation

**Mermaid integration**: `theme.mjs` (articleClient + landingClient) dynamic-imports mermaid from cdn.jsdelivr.net after `applyDiff` and calls `mermaid.run()` on `.mermaid` blocks. `startOnLoad` must be false—the parse happens before article injection, so `startOnLoad` would miss injected blocks. Theme auto-detects color scheme via `prefers-color-scheme`.

**Navigation**: `site/content/globals/navigation.yaml` uses grouped entry format—each item is either `{label, href}` (single link) or `{label, group: [{label, href}, ...]}` (dropdown menu). Dropdowns render via `<details>/<summary>` in `theme.mjs::GmTopbar`; no JS required. In-page topbars in docs/paper*.html et al. render directly on file open and must be kept in sync with the same markup.

**Landing page renderer**: the deployed `/` route on https://anentrypoint.github.io/gm/ is rendered by `site/theme.mjs` from `site/content/pages/home.yaml` via flatspace. `site/index.html` + `site/main.js` build `docs/bundle.js` for non-flatspace standalone preview only. Landing edits go through `site/theme.mjs` (Hero) and `site/content/pages/home.yaml` (content), never `site/index.html`.

**docs/styles.css is generated**: regenerated from `site/input.css` by `site/package.json` build script (copies input.css → docs/styles.css after esbuild). Direct edits to docs/styles.css are wiped on next build — append to site/input.css instead.

## Made with gm Page

`docs/made-with.html` is a static showcase of notable AnEntrypoint projects. Update the PROJECTS array when a new notable project is added — projects with interesting descriptions, meaningful star counts, or technically unusual scope. Static data, no runtime API calls. Standalone HTML, not bundled.

