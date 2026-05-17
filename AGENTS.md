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

## plugkit is the brain

The PLAN → EXECUTE → EMIT → VERIFY → COMPLETE state machine lives natively in rs-plugkit at `rs-plugkit/src/orchestrator/{mod,state,transitions,mutables,memorize}.rs`. The orchestrator owns phase tracking, mutables resolution, memorize firing, and transition legality. plugkit exposes four verbs over the binary surface: `transition` (advance phase, enforce gate), `mutable-resolve` (witness an unknown), `memorize-fire` (commit a fact to rs-learn), `phase-status` (read current state and pending mutables). All harnesses (gm-skill and every gm-<platform>) call these verbs; no harness reimplements the state machine.

## gm-skill is the canonical universal harness

`gm-starter/skills/gm-skill/SKILL.md` is the single source of truth for harness behavior. It is the only skill shipped — the legacy 15-platform fanout (gm-cc, gm-gc, gm-oc, gm-codex, gm-kilo, gm-qwen, gm-hermes, gm-thebird, gm-vscode, gm-cursor, gm-zed, gm-jetbrains, gm-copilot-cli, gm-antigravity, gm-windsurf) is retired; those downstream repos are archived. Users install gm-skill directly into whatever harness they use.

## Tool surface is plugkit-only

Every skill's `allowed-tools:` frontmatter is reduced to `Skill, Read, Write`. `Write` is permitted exclusively for spool dispatch (writing into `.gm/exec-spool/in/<lang>/`). All other side effects — code execution, git, browser, recall, memorize, codesearch — route through the spool and are serviced by plugkit. The harness never reaches around plugkit; if a capability is missing, add it as a plugkit verb, not as a skill-side tool.

## Core Rules

**Shared memory & search index are tracked, never ignored**: `.gm/rs-learn.db` and `.gm/code-search/` are committed so memory and index state shares across machines, sessions, and CI. Tooling, scripts, and any agent editing `.gitignore` must NEVER add `.gm/`, `.gm/rs-learn.db`, `.gm/code-search/`, or legacy `.code-search/` to ignore rules. Per the gitignore parent-re-include caveat (re-including a path past an ignored parent dir is impossible), individual `.gm/*` entries (prd-state.json, lastskill, turn-state.json, trajectory-drafts/, ingest-drafts/, rslearn-counter.json) are listed one-by-one between `# >>> gm managed` markers, leaving `.gm/rs-learn.db` and `.gm/code-search/` un-ignored. Same rule for downstream repos: `lib/template-builder.js::generateGitignore()` must not emit any of those paths. Any project-local persistent state (chunk index, DB, embeddings) must write under `.gm/<name>/`, never to a top-level dotfile/dotdir.

**Disciplines are isolated knowledge stores**: per-project, at `<project>/.gm/disciplines/<name>/{rs-learn.db, code-search/}`. Each discipline owns its own rs-learn DB and code-search index. When a `@<name>` sigil is present in the request, isolation is strict — cross-discipline reads are forbidden. Without a sigil, reads (recall/codesearch) fan across `default` plus every enabled discipline (one per line in `<project>/.gm/disciplines/enabled.txt`) and merge-rank results with `[discipline:<name>]` prefixes; writes (memorize/ingest/index) without a sigil go to `default` only. Disciplines are tracked in git, never ignored — `lib/template-builder.js::generateGitignore()` and the gm-managed gitignore markers in downstream repos must not list `.gm/disciplines` or any subpath. Skills (memorize, recall, code-search, research, planning, gm-execute) propagate the `@<name>` sigil verbatim through their dispatch chain.

**Clean build required**: `cleanBuildDir()` must delete the entire output dir before regenerating. Skipping causes stale files to silently shadow new ones.

**Nothing fake in source the user runs**: stubs, mocks, placeholder returns, fixture-only paths, demo-mode short-circuits, and "TODO: implement" bodies are forbidden in shipped code. Scaffolds and shims are permitted only when they delegate to real behavior (real upstream API, real subprocess, real disk). Before adding a shim, check whether a published library or tool already provides that surface — maintaining a local reimplementation of an upstream solution drifts and ages. Detection is behavioral, not by keyword: code that always succeeds, returns the same value regardless of input, or short-circuits a real call to satisfy a type signature is a stub. Acceptance is real input through real code into real output, witnessed; anything less leaves the mutable open.

**Spool dispatch gates**: `lib/spool-dispatch.js` implements marker-file gate logic that controls tool use, writes, and git operations. `checkDispatchGates(sessionId, operation)` reads marker files (`.gm/prd.yml`, `.gm/mutables.yml`, `.gm/needs-gm`, `.gm/gm-fired-<id>`) and returns `{allowed: bool, reason: string}`. Gates are checked at the CLI/bootstrap layer before tools execute. Tool denials via gate checks report the reason text to the model so it can adjust behavior (e.g., resolve mutables before retrying). Gate denials never mutate command arguments — they surface policy as imperative instruction via reason string.

**memorize sub-agent manages CLAUDE.md / AGENTS.md**: Do not inline-edit. Invocation: `Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')`. Classifier rejects changelog-shaped facts from AGENTS.md ingestion (rs-learn store still accepts them).

**Autonomy**: Once a PRD is written, agents EXECUTE through to COMPLETE without asking. Asking permitted only as last resort for destructive-irreversible decisions or genuinely ambiguous user intent — prefer `exec:pause` over in-conversation asking. **The user's first request IS the authorization** — re-asking "want me to do X?" or "shape A vs B?" after the user said "do X" is forced closure dressed as deference. When two viable approaches exist, pick the read matching the obvious meaning, declare the choice in one line so the user can interrupt mid-chain, and execute. Multi-repo scope, build cost, CI duration, and binary-size impact are NEVER grounds to re-confirm. "Which of two viable approaches" is not ambiguous intent.

**Maximize the scope**: When the request admits a deeper, broader, or more thorough shape that is reachable from this session, take that shape. The "is this too much work?" question is the agent's, not the user's; the answer is yes whenever the larger shape matches the spirit of the ask. "Deeply integrate", "do it right", "all of them", "every X", "across the whole Y", "keep going", and silence between options all read as *go wider*, not narrower. Default to the maximum scope the obvious read supports; declare the read in one PRD line so the user can interrupt; execute. A PRD that ships a smaller-than-necessary slice while a larger reachable shape exists is the same failure as distributed refusal. The bar for *not* expanding is the destructive-irreversible-and-not-covered bar; below that bar, larger always beats smaller.

**Daemonize-by-default exec contract**: rs-exec `execute` returns task_id immediately and the spool watcher tails the task logfile (`~/.claude/gm-log/tasks/<session_id>/<task_id>.log`) for ≤30s wall-clock before returning. Short tasks complete inside the window and look synchronous; long tasks return the task_id with partial output and continue running. Continue with `exec:tail` (drain more output, bounded), `exec:watch` (resume blocking until text/regex match or timeout), or `exec:close` (terminate). `exec:wait` is a pure timer; `exec:sleep` blocks on a specific task's output; `exec:watch` is the match-or-timeout primitive over a task's logfile. Every rs-exec RPC response carries a top-level `running_task_ids: [{id, cmd, elapsedMs}]` field for the calling session — the CLI layer surfaces this so the agent never loses track of background work it spawned. New `spawn`/`tail`/`watch`/`wait`/`killSessionTasks` RPCs live alongside `execute` for back-compat.

**Session-end cleanup**: rs-exec terminates session tasks only on real-exit reasons (`clear`, `logout`, `prompt_input_exit`). Compaction/handoff reasons leave session tasks alive — the agent expects to resume from where it left off.

**gm subagent satisfies the gate equivalently to gm skill**: Both `Skill(skill="gm:gm")` AND `Agent(subagent_type="gm:gm")` clear the needs-gm gate by writing `.gm/gm-fired-<sessionId>` marker. Subagent form is preferred for sustained multi-turn work because it isolates the orchestration loop in its own context window; skill form remains valid for short turns.

**Maximal Cover (covering-family obligation)**: When scope exceeds reach, enumerate all witnessable subsets and execute every member. Write the family into `.gm/prd.yml` as separate items with explicit dependency graph for parallelization. Residuals the agent judges within the spirit of the original ask AND completable from this session are self-authorized — expand the PRD with them and execute, do not stop to re-ask the user. Only residuals genuinely outside the original ask OR genuinely unreachable from this session are name-and-stop. When expanding under self-authorization, the agent declares its judgment in-response ("treating X as in-scope because Y") so the user can correct mid-chain. Silent expansion without the declaration is the failure mode this rule guards against. Detection: committed work + named out-of-spirit residuals must equal the witnessable closure; gap means cover is not yet maximal, re-enter PLAN.

**Sync-before-emit (codeinsight + search)**: rs-codeinsight and rs-search outputs must come from a freshly-completed index. No cache may serve a result without a digest match against the live filesystem (mtime sum + git HEAD + dirty-tree marker). Default invocation always runs fresh. `--read-cache` permitted only when `.codeinsight.digest` matches exactly; on mismatch the cache auto-refreshes before emitting. rs-search runs scan + embed + sweep before printing the first result and emits an `[index fully synced: …]` line so freshness is visible. Emitting from an unverified or partial index is forced closure equivalent to bluffing strength — the agent reads stale output as ground truth and acts on a state that no longer exists.

**Auto-recall on prompt-submit**: rs-plugkit prompt-submit hook derives a 2-6 word recall query from the user prompt, calls rs-learn `Searcher` directly via the shared tokio Runtime, and injects "## Recall for this prompt" into the systemMessage. Auto-search (codeinsight) runs at session-start; auto-recall runs at every prompt. Together they ensure every turn begins with prior memory loaded.

**ORIENT before naming any unknown**: planning skill prescribes a parallel pack of 3-5 `exec:recall` + 3-5 `exec:codesearch` calls before the first mutable is named. Hits become weak_prior; misses confirm the unknown is fresh. Cost equals skip cost — orient is free relative to the duplicated discovery and disagree-with-prior-witness risk it prevents.

**PRD MANDATORY**: writing `.gm/prd.yml` is non-negotiable for every task whose scope exceeds a literal single-file single-line edit. Skipping the PRD costs the same as writing it (the agent enumerates the work mentally either way) and loses durable trace, resumability, and the cover-maximality check.

**Skill SKILL.md frontmatter `allowed-tools:` is harness-enforced**: If a skill omits `allowed-tools` or does not list `Skill`, the model loses the ability to hand off to the next skill in the chain that turn. Symptom: model writes a PRD then stops at `→ gm-execute` without invoking it — appears to be laziness but is actually a tool gate. Any new skill participating in the chain (especially those transitioning to gm:gm-execute or other downstream skills) MUST list `Skill` in `allowed-tools`, or omit the line to inherit the default full tool set.

**rs-exec RPC session isolation**: Every RPC handler touching per-task or per-session resources must require non-empty `sessionId` in params and verify the task's stored `session_id` matches before read/mutate. Empty sessionId always returns forbidden—never falls through. Applies to: tail, watch, getTask, deleteTask, appendOutput, getAndClearOutput, waitForOutput, sendStdin (task-scoped RPCs) and listSessionTasks, drainSessionOutput, killSessionTasks, deleteSessionTasks (session-scoped RPCs). Task-creating RPCs (spawn, execute) require non-empty sessionId to avoid orphaned tasks. Known gap: startTask/completeTask/failTask spawned-child callbacks lack sessionId verification. Browser sessions separately scoped via `browser_session_map_file()` keyed by `claude_session_id`.

**Windows: kill before rmSync**: `fs.rmSync` of a directory hangs (does not error) when any process holds open handles to binaries inside it. Code that removes a versioned cache dir (bootstrap.js `pruneOldVersions` and similar) MUST terminate processes whose image paths live under that dir FIRST, then rmSync with `{maxRetries:1, retryDelay:50}` so residual EBUSY fails fast. Past bug: bootstrap startup-hang when stale `plugkit-win32-x64.exe` processes held v<old>/ handles — fixed by reordering all 5 cache-resolve branches to kill-first, prune-second.

**Windows: kill before renameSync on long-lived binaries**: atomic in-place rename of `~/.claude/gm-tools/plugkit.exe` blocks with EBUSY/EPERM/EEXIST/EACCES when a concurrent plugkit invocation holds the file mapped. Bootstrap `copyToGmTools` MUST (1) sweep stale `plugkit*.new` orphans before writing new tmp file, (2) attempt `renameSync(tmp, target)` with retry+backoff, (3) on persistent busy signal enumerate processes via `wmic process list brief` whose ExecutablePath matches target and `taskkill /F /PID` them, then retry, (4) throw on exhausted retries so top-level `.catch` writes `.gm/exec-spool/.bootstrap-error.json`. Swallowing the rename failure silently causes the bootstrap-failed-every-turn defect: bootstrap returns ok, but `isReady()` sha-checks the live binary against the manifest, mismatches, and prompt-submit prints `[plugkit] bootstrap failed; aborting hook` on every turn for as long as a concurrent process holds the stale binary. Diagnosis signature: dangling `plugkit*.new` files plus `plugkit.exe` whose sha256 does not match the manifest. Applies to any future in-place binary swap under `~/.claude/gm-tools/` held open by other processes.

**Skill-initiated bootstrap contract**: `gm-starter/lib/skill-bootstrap.js` wraps `bootstrap.js` for skill-driven binary initialization without hook infrastructure. `bootstrapPlugkit(sessionId)` async function accepts optional SESSION_ID, calls `bootstrap(opts)` from bin/bootstrap.js directly (no reimplementation), and writes status/error to `.gm/exec-spool/.bootstrap-status.json` and `.bootstrap-error.json` for spool awareness. Binary download, sha256 verification, lock management, and stale process cleanup are delegated to `bootstrap.js`; skill layer handles only result marshaling and session threading. Used by skills (planning, gm-execute, update-docs) for daemon spawn without session_start hook. Return: `{ ok: true, binaryPath }` on success, `{ ok: false, error: message }` on failure.

## Rust Binary Update Pipeline

Every change to any Rust library auto-cascades all the way to the installed binary:

```
rs-exec / rs-codeinsight / rs-search
  → push to main
  → .github/workflows/cascade.yml triggers rs-plugkit workflow_dispatch
  → rs-plugkit release.yml: cargo update, builds 6 binaries, auto-bumps patch version
  → publish-binaries job uploads to AnEntrypoint/plugkit-bin Releases (sha256 manifest, plugkit.version)
      bumps gm-starter/gm.json::plugkitVersion + gm-starter/bin/plugkit.version in AnEntrypoint/gm
      NEVER pushes binaries into gm history
  → that commit triggers gm publish.yml
  → publish.yml single-platform matrix:
      - node cli.js gm-starter ./build (regenerates the gm-skill package)
      - copies plugkit.version + plugkit.sha256 into build/gm-skill/bin/
      - npm publish build/gm-skill
  → users on npm pull gm-skill@latest → bootstrap.js downloads new binary
```

There is one published artifact: the `gm-skill` npm package. The legacy 15 downstream repos (gm-cc, gm-gc, gm-oc, gm-kilo, gm-codex, gm-qwen, gm-copilot-cli, gm-hermes, gm-thebird, gm-vscode, gm-cursor, gm-zed, gm-jetbrains, gm-antigravity, gm-windsurf) are archived on GitHub — no further releases, no orphan-commit publish step.

**acptoapi provider and ACP agent auto-spawn**: DaemonBootstrap (`lib/daemon-bootstrap.js`) checks if 127.0.0.1:4800 is reachable; if not, spawns `bun x acptoapi@latest` as a background daemon and auto-detects available ACP agents (opencode, kilo-code, codex, gemini-cli, qwen-code, hermes) to run invisibly as subprocesses. Binary detection uses `where` (Windows) / `which` (Unix); agents not found are skipped gracefully. Daemon and agent spawning runs in a detached thread to avoid blocking session_start. On Windows, agents spawn with DETACHED_PROCESS flag (0x08000000) and no console window. acptoapi is the primary LLM provider for all downstream repos (rs-learn, freddie, acptoapi itself); the Anthropic SDK serves as fallback only when acptoapi is unavailable. All agents run in ACP stdio mode (NDJSON JSON-RPC 2.0 over stdin/stdout). See rs-learn.db for per-agent binary paths, install methods, and invocation details.

**gm-skill daemon-bootstrap integration**: Skill-driven daemon spawning via the `gm-skill` package invokes `daemon-bootstrap.js` (5 exported functions: checkState, spawn, waitForReady, getSocket, shutdown) through `gm-starter/lib/skill-bootstrap.js` synchronously to establish daemon processes before skill execution. Daemon state is verified per-session (127.0.0.1:4800 reachable check) and persisted in .gm/turn-state.json. Bootstrap failures (unresponsive socket, spawn timeout) are logged to .gm/exec-spool/.bootstrap-error.json and treated as non-fatal (fallback to Anthropic SDK). Daemon processes are terminated on session_end via killSessionTasks RPC only on real-exit reasons (clear/logout/prompt_input_exit).

**Repos involved (push to any triggers cascade):**
- `AnEntrypoint/rs-exec` — exec runner, browser sessions, idle cleanup, session task isolation
- `AnEntrypoint/rs-codeinsight` — code search backend, symbol indexing
- `AnEntrypoint/rs-search` — file search backend, embedding and sweep
- `AnEntrypoint/rs-plugkit` — CLI entry point, spool watcher dispatcher; version source of truth in `Cargo.toml`
- `AnEntrypoint/rs-learn` — memory backend, recall/ingest via HTTP RPC
- `AnEntrypoint/gm` — `gm-starter/gm.json` holds `plugkitVersion`; CI publishes the single `gm-skill` npm package

**To update anything**: push to the relevant repo. No manual version bumps, no local cargo builds. Never run `cargo update` or `cargo build` locally — push and let CI build.

**PUBLISHER_TOKEN required** in `rs-exec`, `rs-codeinsight`, `rs-search` for cascade.yml to trigger rs-plugkit. Set with: `gh secret set PUBLISHER_TOKEN --repo AnEntrypoint/<repo>`.

**Timeout enforcement**: `timeoutMs` is mandatory in the `execute` RPC — rs-exec hard-rejects missing or zero values with `anyhow!("timeoutMs required (positive integer milliseconds)")`. rs-plugkit CLI layer (Cmd::Exec, Cmd::Bash) accepts `--timeout-ms <u64>` with a DEFAULT_EXEC_TIMEOUT_MS=300_000 silent default (deprecation warning removed 2026-05-02 after serving its transitional purpose). On timeout, rs-exec returns `"timedOut": true` alongside partial output (preserved in both success and failed branches). plugkit prints `[exec timed out after Nms; partial output above]` to stderr and returns exit code 124 when no child exit code was captured. Do not pass --timeout-ms explicitly inside exec:bash bodies calling plugkit exec—the wrapper already injects this flag, and clap rejects duplicates. Downstream code (spool dispatcher, agent-side callers) must pass explicit per-call-site budgets to rs-exec's execute RPC.

## rtk Auto-Wrapping in exec:bash

rs-exec injects an rtk shell-function preamble into every bash script so common dev commands (git/cargo/pytest/jest/npm/yarn/pnpm/tsc/eslint/docker/kubectl/ruff/mypy/ls/find/diff/rg) transparently route through the rtk CLI proxy for token compression. Gated on `which("rtk")` + `RTK_DISABLE` unset + `RTK_ACTIVE` unset (recursion guard). Per-call escape: `RTK_BYPASS=1 <cmd>`. Wrapped-command list is a const array in `rs-exec/src/runtime.rs` near `rtk_preamble()` — adding a command is one line, push to rs-exec, cascade rebuilds everything. rtk binary is built from source in `rs-plugkit/.github/workflows/release.yml` via `cargo install --git rtk-ai/rtk` (rtk has no Rust library surface; no upstream prebuilt path) across all 6 targets including win-arm64 which upstream rtk-ai releases skip. Bootstrap fetches rtk best-effort alongside plugkit; absence never blocks plugkit usage.

## Spool-dispatch architecture replaces hooks

Orchestration state is tracked via marker files in `.gm/` instead of hook events. `SpoolDispatcher` reads these markers via `checkDispatchGates(sessionId, operation)` and gates tool use, writes, and git operations:

**Marker files**: `.gm/prd.yml` (existence triggers needs-gm gate), `.gm/mutables.yml` (unresolved entries block Write/Edit/git), `.gm/needs-gm` (written by bootstrap, read by dispatcher), `.gm/gm-fired-<sessionId>` (written by gm skill/agent, cleared at turn start), `.gm/residual-check-fired` (ensures one-shot residual-scan per stop window).

**Gate enforcement**: CLI layer (plugkit, rs-exec, downstream platforms) calls `checkDispatchGates()` before tool execution. On denial, reason text surfaces to the model. Bootstrap (gm-starter/lib/skill-bootstrap.js) handles daemon initialization and marker setup. Marker-driven dispatch replaces hook event pump entirely — no session event callbacks needed.

**gm:gm tool-use sequencing**: Skill(gm:gm) OR Agent(subagent_type="gm:gm") writes `.gm/gm-fired-<sessionId>` to clear the needs-gm gate. Agent clears the marker at turn start to reset the gate. Subagent form preferred for sustained multi-turn work (isolates orchestration loop); skill form valid for short turns.

**Session lifecycle**: Session-end kills background tasks via `killSessionTasks` RPC on real-exit reasons (clear/logout/prompt_input_exit). Browser sessions and background tasks persist across turn-stops — cleanup happens exclusively on real-exit reasons. Residual-scan fires when PRD is empty/missing AND no open browser sessions AND no running tasks; agent either expands PRD with in-spirit residuals or explicitly states none.

## Spool observability surface

Every agent has a one-shot system-state probe: dispatch `plugkit health` via the file-spool (write `.gm/exec-spool/in/health/<N>.txt` empty body, read `out/<N>.json`). Returns plugkit version + pin-match, watcher liveness, runner state, rs-learn status, cache dirs, inbox/outbox counts, recent hook fires, recent errors. Use before assuming any component is broken.

Three persistent diagnostic files at `.gm/exec-spool/` root are updated by the running stack (not the agent): `.status.json` (watcher state each tick; stale mtime = dead watcher), `.last-session-start.json` (most recent session-start spawn result), `.bootstrap-error.json` (pin-mismatch / fetch-fail surface — absent = healthy). Reading these directly via Read is allowed (runtime data exception); spool dispatch isn't needed to inspect them.

Every rs-plugkit hook entrypoint emits `obs::event` JSONL to `~/.claude/gm-log/<date>/hook.jsonl`. Denial seen but no log entry = hook isn't firing; diagnose at that layer, not at policy.

## Observability is on by default

Every program in the gm stack writes structured JSONL to `~/.claude/gm-log/<YYYY-MM-DD>/<subsystem>.jsonl` (subsystems: exec, hook, plugkit, rs_learn, rs_codeinsight, rs_search, bootstrap, plugkit_wrapper). Inspect with `plugkit log {path|tail|grep|stats|prune|subsystems}` instead of re-running with print debugging. `tail` merges entries across all subsystems sorted by timestamp. `subsystems` lists today's .jsonl basenames. `stats --days N` aggregates totals across last N days (default behavior unchanged when --days omitted). `prune --days N` removes day-dirs older than N (default 14) — manual only. Logs are never auto-deleted; retention is the user's call. The user runs `plugkit log prune --days N` when they want to reclaim disk. Disable logging via `GM_LOG_DISABLE=1`; relocate via `GM_LOG_DIR`. Instrumentation lives at the dispatch boundary (one wrap per dispatcher covers all variants) — never per-handler scatter. Same discipline applies to code written for users: extend the project's existing observability surface, or seed one with a tiny JSONL appender to `.gm/log/` mirroring the plugkit shape. Emit on state transitions, error boundaries, external IO, nontrivial decisions; skip loop bodies and parser steps.

## exec:nodejs Silent Errors

exec:nodejs code that hits fs.readFileSync ENOENT or other synchronous system errors appears to complete silently (no output, exit code 0) until rs-exec receives the bun 1.3.8 mitigation via cascade. Until cascade lands, wrap filesystem operations in explicit try/catch blocks that call `console.error(e)` and `process.exit(1)` to surface errors.

## Site Build & Documentation

**Mermaid integration**: `theme.mjs` (articleClient + landingClient) dynamic-imports mermaid from cdn.jsdelivr.net after `applyDiff` and calls `mermaid.run()` on `.mermaid` blocks. `startOnLoad` must be false—the parse happens before article injection, so `startOnLoad` would miss injected blocks. Theme auto-detects color scheme via `prefers-color-scheme`.

**Navigation**: `site/content/globals/navigation.yaml` uses grouped entry format—each item is either `{label, href}` (single link) or `{label, group: [{label, href}, ...]}` (dropdown menu). Dropdowns render via `<details>/<summary>` in `theme.mjs::GmTopbar`; no JS required. In-page topbars in docs/paper*.html et al. render directly on file open and must be kept in sync with the same markup.

**Landing page renderer**: the deployed `/` route on https://anentrypoint.github.io/gm/ is rendered by `site/theme.mjs` from `site/content/pages/home.yaml` via flatspace. `site/index.html` + `site/main.js` build `docs/bundle.js` for non-flatspace standalone preview only. Landing edits go through `site/theme.mjs` (Hero) and `site/content/pages/home.yaml` (content), never `site/index.html`.

**docs/styles.css is generated**: regenerated from `site/input.css` by `site/package.json` build script (copies input.css → docs/styles.css after esbuild). Direct edits to docs/styles.css are wiped on next build — append to site/input.css instead.

## Made with gm Page

`docs/made-with.html` is a static showcase of notable AnEntrypoint projects. Update the PROJECTS array when a new notable project is added — projects with interesting descriptions, meaningful star counts, or technically unusual scope. Static data, no runtime API calls. Standalone HTML, not bundled.

## acptoapi Provider Integrations

**Functional Providers:** acptoapi successfully integrates 12 commercial brand providers (groq, nvidia, cerebras, mistral, together, perplexity, anthropic, openai, google, xai, meta, cohere) via API keys. All are fully operational as HTTP-based providers.

**Stdio-Based Agents (Future Work):** kilo-code and opencode-ai provide `acp` subcommands that implement the Agent Client Protocol (ACP) over stdio (ndjson), not HTTP. Current acptoapi architecture assumes all providers expose HTTP endpoints on fixed ports. Integrating stdio-based agents (kilo on port 4780, opencode on port 4790) requires a wrapper layer that spawns the subprocess and translates between HTTP and stdio transports. This is a known limitation; the infrastructure exists but the wrapper implementation is not yet complete. Both tools are documented and installable (`which kilo`, `which opencode` return paths), but `kilo acp` and `opencode acp` spawn as subprocesses expecting stdio communication, not HTTP servers.