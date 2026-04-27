# Architecture & Philosophy

gm generates 10 platform implementations from a single convention-driven source.

## Documentation Policy

Only record non-obvious technical caveats that cost multiple runs to discover. Remove anything that no longer applies. Never document what is already obvious from reading the code.

**No changelog history in AGENTS.md.** Every entry is a present-tense rule about what must or must-not be the case in code now. Forbidden: `(FIXED)` markers, commit hashes ("fixed in commit abc123"), dated audit entries ("Run 2026-04-25: ..."), `## Learning audit` sections, "(added 2026-04-DD)" annotations, "Validated 2026-04-DD: X" one-time results, "we used to X, now we Y" phrasing. Historical framing belongs in `git log` and `CHANGELOG.md`. The memorize sub-agent's classifier rejects changelog-shaped facts from AGENTS.md ingestion (rs-learn store still accepts them).

## Coding Style

**No comments in code.** No inline, block, or JSDoc comments anywhere — source, generated output, hooks, scripts.

**Skill SKILL.md files:** Strip all explanatory prose ("how it works", "why this matters", mechanism descriptions). Keep ONLY invocation syntax, transition arrows, gate conditions, constraint lists, and code examples showing exact usage. Skill docs are usage instructions for agents, not implementation references. Removes ~60% token overhead from verbose prior versions.

## Build

```
node cli.js gm-starter ./build
```

10 outputs in `build/gm-{cc,gc,oc,kilo,codex,copilot-cli,vscode,cursor,zed,jetbrains}`.

## Known Gotchas

**Shared memory & search index are tracked, never ignored**: `.gm/rs-learn.db` (rs-learn episodes / community summaries) and `.code-search/` (rs-codeinsight chunk index) are intentionally committed so memory and index state shares across machines, sessions, and CI. Tooling, scripts, and any agent editing `.gitignore` must NEVER add `.gm/rs-learn.db`, `.gm/`, or `.code-search/` to ignore rules. The `.gm/` parent cannot be ignored as a whole — per the gitignore parent-re-include caveat, individual `.gm/*` entries (prd-state.json, lastskill, turn-state.json, trajectory-drafts/, ingest-drafts/, rslearn-counter.json, etc.) are listed one-by-one between `# >>> gm managed` markers, leaving `.gm/rs-learn.db` and `.gm/code-search/` un-ignored. Same rule applies to downstream repos: `lib/template-builder.js::generateGitignore()` must not emit `.gm/`, `.gm/rs-learn.db`, or `.code-search/` lines. If a session writes a stray `rs-learn.db` at repo root (legacy migration path), move it to `.gm/rs-learn.db` rather than gitignoring it.

**Tailwind CSS v4 syntax**: Flatspace builds must use `@import "tailwindcss";` instead of legacy `@tailwind base/components/utilities;` syntax. This affects the CSS input file (e.g., `src/styles/input.css`). Also requires `npm install` in CI before running the build command.

**CI auto-bump race condition**: When multiple pushes hit AnEntrypoint/gm in rapid succession, the auto-bump step in `publish.yml` fails with "remote rejected — cannot lock ref: is at X but expected Y". Auto-bump reads HEAD, commits, then pushes — a concurrent push already moved HEAD. Self-recovering: the next CI run succeeds. Do NOT modify the workflow. Symptom: `Build & Publish Plugins` failure in `prepare` job at "Auto-bump version if needed" step.

**npm publish E403 race condition**: gm's `publish.yml` pushes to downstream repos AND publishes to npm. The push triggers the downstream repo's own `publish-npm.yml`, which tries to publish the same version again → E403. Both `lib/template-builder.js:generatePublishNpmWorkflow()` and `gm-starter/.github/workflows/publish-npm.yml` must tolerate "cannot publish over previously published versions" by grepping the error output instead of failing.

**Adding a new platform**: update `PLATFORM_META` in `lib/page-generator.js` — this is the single registration point, not obvious from the adapter structure.

**Clean build required**: `cleanBuildDir()` must delete the entire output dir before regenerating. Skipping causes stale files to silently shadow new ones — the build appears to succeed but old output persists.

**Skills bundled in OC and Kilo**: gm-oc and gm-kilo now bundle skills directly in the npm package. gc still uses external skills — its `loadSkillsFromSource()` returns `{}` intentionally.

**OpenCode/Kilo plugin registration**: Copying `.mjs` to `plugins/` dir is not enough. Both tools require an explicit path entry in the `plugin` array in `opencode.json`/`kilocode.json`. They do not auto-discover from the plugins directory.

**Hook error display**: When pre-tool-use-hook blocks a tool call, Claude Code shows "Sibling tool call errored" instead of the actual block reason. The hook is working correctly — the real reason is in the system reminder.

**exec:bash shell builtins absent**: The exec:bash wrapper runs scripts via a temp-file shell invocation that does NOT include bash builtins like `time`, `pushd`, `popd`, `source`. Symptom: `time: command not found` or `pushd: command not found`. Workarounds: use `START=$(date +%s%3N); ...; END=$(date +%s%3N)` for timing, absolute paths or plain `cd` for directory work. Documented in gm-starter/prompts/bash-deny.txt for agent visibility.

**Windows conhost flash on child-process spawn**: On Windows, spawning console-subsystem programs (git.exe, npm.cmd, powershell.exe, netstat.exe) via bare `Command::new(x).output()` or `.spawn()` without the `CREATE_NO_WINDOW` (0x08000000) creation flag briefly opens a visible conhost window. This manifests as flashing windows during prompt submission when rs-plugkit invokes git via downstream crates. Fix: introduce a small helper per Rust crate (e.g., `git_cmd()`, `no_window_cmd()`) that wraps all spawns with `creation_flags(0x08000000)` on `#[cfg(windows)]`. Do NOT depend on upstream helpers — each crate that spawns must own its wrapper. Alternative valid flag: `0x08000008` (DETACHED_PROCESS | CREATE_NO_WINDOW) in daemon contexts.

**rs-plugkit must not shell to `bun x rs-learn`**: The scoop bun.exe shim is a Windows console-subsystem wrapper that opens its OWN visible console window when spawned, regardless of parent `CREATE_NO_WINDOW` (0x08000000) — same shim-window class as the claude.exe caveat below. Symptom: flashing windows during hook activity (recall/ingest/feedback/build-communities). Fix in `rs-plugkit/src/hook/rs_learn.rs`: `run_bun_rs_learn` / `spawn_detached_bun_rs_learn` replaced with direct rs-learn lib calls via a shared `tokio::runtime::Runtime` (OnceLock, 2 worker threads). Cargo deps required: `rs-learn = git AnEntrypoint/rs-learn branch main`, `libsql = "0.9"` with `default-features=false features=["core","serde"]` (libsql needed for direct `store.conn.query` / `params!` in forget/episodes paths). Hard rule: any new hook code needing rs-learn must route through `run_with_timeout` / `spawn_detached` helpers in `src/hook/rs_learn.rs`. Never `Command::new("bun")` for rs-learn ops anywhere in rs-plugkit. HTTP fast-path (`rs-learn serve` over plain TCP, no shim) still wins for hot recall (~5ms); direct lib falls back when serve isn't running (~50-200ms cold per call). API surface used: `Store::open`, `Embedder::new`, `backend::from_env`, `graph::llm::LlmJson::new`, `graph::search::{Searcher, SearchConfig}`, `graph::ingest::Ingestor::{new, add_episode_fast, clear_graph}`, `graph::communities::CommunityOps::{new, build_communities}`, `observability::dump`, `Orchestrator::new_default + .feedback`, `learn::instant::FeedbackPayload`. DB path: each `open_graph(project_dir)` builds `<project_dir>/.gm/rs-learn.db` unless `RS_LEARN_DB_PATH` env override set; Orchestrator paths require setting `RS_LEARN_DB_PATH` first.

**Bounded LLM concurrency — claude.exe opens its own window**: On Windows, claude.exe is a Node.js binary wrapped via a .cmd shim that opens its OWN UI window. Parent-side `CREATE_NO_WINDOW` (0x08000000) does NOT suppress this — distinct from the conhost flash issue. Any code path that ultimately spawns `claude.exe` / acp / a fresh LLM process must be gated through a bounded semaphore. rs-learn `src/llm_gate.rs` defines a process-global `tokio::sync::Semaphore` (`LLM_GATE`, `OnceLock`) acquired inside both concrete `AcpClient::generate()` (src/acp/mod.rs:126) and `ClaudeCliClient::generate()` (src/backend/claude_cli.rs:44) — the single chokepoint for spawning claude.exe from any path. Default permits=1 (strict sequential), env override `RS_LEARN_LLM_MAX_PARALLEL`, clamped to `[1,3]`. Hard rule for any new tooling that fans out LLM calls (rs-learn graph ops, rs-codeinsight summarizers, rs-search re-rankers, etc.): never use unbounded `tokio::spawn` / `join_all` / `FuturesUnordered`; gate via the same pattern. Callers must route through AcpClient::generate or ClaudeCliClient::generate (or AgentBackend trait dispatching to them); never spawn claude.exe via raw Command::new outside backend/. Symptom of missing gate: cascading visible Claude session windows on Windows when rs-learn runs inside a Claude Code session (spawnpoint cwd with .gm/rs-learn.db reproduces).

**Sleep semantics — exec:sleep vs exec:wait**: `exec:sleep` waits for a specific background task to produce output (takes a task_id). `exec:wait` is the raw timer (takes seconds, max 3600). Raw `sleep N` inside exec:bash is blocked at the hook and redirected to exec:wait. Utility verbs (sleep/wait/pause/status/close) route at the hook boundary, not the runtime dispatcher — otherwise they get "Unsupported runtime: sleep" from the language router.

**.gm/turn-state.json — per-turn state for compliance hooks**: `prompt-submit-hook.js` resets `.gm/turn-state.json` at the start of every user turn with `{turnId, firstToolFired:false, execCallsSinceMemorize:0, recallFiredThisTurn:false}`. `post-tool-use-hook.js` increments `execCallsSinceMemorize` on every Bash result >20 chars whose command isn't a utility verb (recall, memorize, codesearch, wait, sleep, status, runner, type, kill-port, close, pause), sets `recallFiredThisTurn=true` on `exec:recall`, and resets counter to 0 when `Agent(memorize)` is observed. `pre-tool-use-hook.js` hard-blocks the next tool when count ≥ 3 unless `.gm/no-memorize-this-turn` sentinel exists (write with one-line reason to bypass). Additionally, `rs-plugkit/src/hook/pre_tool_use.rs` reads `recallFiredThisTurn` to gate benchmark-pattern blocks: when benchmark heuristic fires (date +%s, time-related, "why is X slow", performance.now, process.hrtime) and `recallFiredThisTurn=false`, hook blocks with redirect to `exec:recall`. Resets on next user turn.

**Autonomy policy**: Once a PRD is written, agents must EXECUTE through to COMPLETE without asking the user. Forbidden patterns: "should I continue", "want me to do X", offering to split work. Asking permitted only as last resort for destructive-irreversible decisions or genuinely ambiguous user intent — and even then prefer `exec:pause` (atomically renames .gm/prd.yml → .gm/prd.paused.yml, converts question text to header comment, returns permission deny to halt execution; prompt_submit.rs auto-renames back on next user turn) over in-conversation asking. Documented in skills/gm/SKILL.md, skills/planning/SKILL.md, prompts/prompt-submit.txt.

**Stop hook timeout (run_stop vs run_stop_git)**: `run_stop()` in rs-plugkit must NOT call `run_stop_git()`. The `hook stop` command has a 15s CC timeout — calling the 180s CI watcher inside it causes "0/2 stop hooks running until timeout". Two separate hooks: `stop` (15s) = browser + prd check only, outputs `approve` directly; `stop-git` (210s) = git dirty + CI watch. Timeout must be CI_WATCH_SECS + 30s margin (180+30=210s).

**kilo/oc exec: must be synchronous**: `plugkit exec` is async/runner-based — it returns a task ID and hangs when called via `spawnSync` from inside a bash tool. The kilo/oc `.mjs` plugin's `tool.execute.before` must run code inline using `spawnSync(bun/node/python3/bash)` and return via `safePrintf`. Never delegate exec: to `plugkit exec --file` from the plugin context.

**gc uses JS hook files, not plugkit binary**: gc's `buildHooksMap` must be overridden directly in the gc factory (not via `buildHookCommand`). If `buildHookCommand` returns a non-null value, `CLIAdapter.buildHooksMap` calls `buildHooksMapCustom` which produces single-object hooks (bare format) for non-stop events — Gemini CLI requires `[{matcher:'*', hooks:[...]}]` arrays for all events. The gc factory uses a `buildHooksMap()` override returning inline object literals. Hook files are JS scripts in `hooks/` generated by `getAdditionalFiles`. Gemini tool is `run_shell_command` (not `Bash`); block response uses `{decision:'deny'}` for tool blocks and `{decision:'block'}` for session stop.

**import.meta.dir vs new URL(import.meta.url).pathname on Windows**: `new URL(import.meta.url).pathname` returns `/C:/dev/...` (leading slash makes it an invalid path). Use `import.meta.dir` instead for resolving sibling file paths (e.g. worker spawn paths). Bun-specific; applies anywhere a Bun script needs its own directory.

**bash_banned_tool blocking & gh CLI wrapping**: plugkit blocks grep/find/rg/glob even in pipes (e.g., `| grep foo`). This is intentional security behavior but overly restrictive. Workaround: avoid these tools in pipes. Fix requires updating `rs-plugkit/src/hook/pre_tool_use.rs` to only block if command *starts with* the tool name, not when present anywhere. Additionally, `gh` CLI commands (e.g., `gh run list`, `gh run view`) are not in the whitelist and must be wrapped in `exec:bash` — direct invocation via Bash tool returns "only accepts these exact formats" error. This applies to all session harnesses using the plugkit hook (gm, rs-exec, rs-search, rs-codeinsight, rs-plugkit repos).

**rs-exec browser cleanup on session end**: `SessionCleanup` must call `runtime::kill_session_browser()` to release the browser process and port mapping. Without it, idle-timeout session ends leave zombie tabs that reappear on reconnect.

**rs-exec session-cleanup subcommand**: `rs-plugkit/src/session_end.rs` spawns `plugkit session-cleanup --session=<id>`. This subcommand must exist in `rs-exec`'s `main.rs` `Cmd` enum or session-end cleanup silently fails — clap exits with an error but null stdio hides it.

**rs-exec mod declarations**: After extracting `rpc.rs` and `kill.rs`, `main.rs` must have `mod rpc; mod kill;` alongside the other `mod` declarations. Missing these causes compile errors on `crate::rpc` and `crate::kill` references in `runner.rs`. Additionally, `lib.rs` must have `pub mod rpc;` — without it the library crate cannot expose rpc to dependents (distinct failure from the main.rs requirement).

**rs-exec multi-bin crate root requires mod declarations in both bins**: rs-exec's Cargo.toml declares two bins — `rs-exec` (src/main.rs) and `rs-exec-process` (src/exec_process.rs). Each bin is its own crate root. Any module used by shared code (e.g., `runtime.rs` calling `crate::kill::kill_tree()`) must be declared in BOTH bin crate roots. Example: if `runtime.rs` uses `crate::kill::...`, both `src/main.rs` AND `src/exec_process.rs` must have `mod kill;`. Missing a declaration in either bin causes E0433 compile error "cannot find X in crate root" on all targets.

**--exec-process-mode flag in rs-exec main()**: The rs-exec binary re-invokes itself with `--exec-process-mode` for each task. `main()` must check for this flag before clap parsing and call `rs_exec::run_exec_process()`. If removed, all code execution fails silently.

**memorize sub-agent manages CLAUDE.md**: Do not inline-edit CLAUDE.md directly. The `memorize` sub-agent (haiku model, run_in_background=true) reads context, extracts non-obvious caveats, deduplicates against existing entries, and writes. Invocation: `Agent(subagent_type='memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<what was learned>')`

**ccsniff compliance audit**: ccsniff (npm package) returns full conversation history as NDJSON with fields: ts, sid, cwd, role, type, text. A comprehensive audit of gm session d256745e-a4d9-47e6-8056-a0576f1e6e68 (72 human turns, ~5000 records) found 33.3% gm-first compliance (24/72 compliant, 48 violations). Dominant violation (70%): text-before-tool — assistant outputs narration text like "I'll invoke gm skill first" BEFORE calling Skill("gm"). Hook correctly enforces tool sequencing (first tool IS Skill(gm)), but response-level text precedes the tool invocation block. This is response-level discipline (prompt says "NO text before first tool"), not a hook defect — hooks fire per-tool, outside response scope. Secondary violations: unavoidable NO_TOOL for system messages (20%), non-gm-first (5%, older sessions), grep/glob (5%). Remediation: response-level training to eliminate text-before-tool narration. Target: ≥90% compliance via documentation + model behavior.

## Rust Binary Update Pipeline

Every change to any Rust library auto-cascades all the way to the installed binary. The chain:

```
rs-exec / rs-codeinsight / rs-search
  → push to main
  → .github/workflows/cascade.yml triggers rs-plugkit workflow_dispatch
  → rs-plugkit release.yml runs: cargo update (picks up latest git deps), builds all 6 binaries
  → auto-bumps rs-plugkit patch version in Cargo.toml + commits [skip ci]
  → publish-binaries job:
      - copies binaries into BOTH gm-build-latest/gm-cc/bin/ AND gm-starter/bin/
      - copies plugkit-win32-x64.exe → plugkit.exe (Windows default)
      - updates plugkitVersion in plugforge/gm-starter/gm.json
      - soft-resets one commit if prior commit was another binary update
        (message starts with "chore: update plugkit binaries")
      - git add -f (forces past gm's .gitignore for gm-build-latest/)
      - force-push-with-lease → keeps gm history from ballooning
  → that commit triggers gm publish.yml
  → publish.yml 12-platform matrix:
      - node cli.js gm-starter ./build (regenerates configs, NOT binaries)
      - copies gm-build-latest/gm-<platform>/bin/ into build/gm-<platform>/bin/
      - git init fresh empty dir (NO clone of downstream — orphan history)
      - rsync build output in
      - git add -A + git add -f bin/ (forces past generated .gitignore)
      - diff --depth 1 clone of downstream to detect no-op
      - git push --force origin main → downstream at 1-commit orphan history
  → /plugin detects new gm-cc HEAD → updates cache → bootstrap.js downloads new binary
```

**Downstream repos (gm-cc, gm-gc, gm-oc, gm-kilo, gm-codex, gm-qwen, gm-copilot-cli, gm-hermes, gm-vscode, gm-cursor, gm-zed, gm-jetbrains)** are reset to a single orphan commit on every publish. This keeps clones small forever (~<1MB) regardless of release count.



**Repos involved (push to any triggers cascade):**
- `AnEntrypoint/rs-exec` — exec runner, browser sessions, idle cleanup
- `AnEntrypoint/rs-codeinsight` — code search backend
- `AnEntrypoint/rs-search` — file search backend
- `AnEntrypoint/rs-plugkit` — binary entry point, hook dispatcher; version source of truth in `Cargo.toml`
- `AnEntrypoint/gm` — `gm-starter/gm.json` holds `plugkitVersion`; CI publishes to gm-cc
- `AnEntrypoint/gm-cc` — Claude Code plugin package; HEAD hash is what `/plugin` tracks

**To update anything**: push to the relevant repo. No manual version bumps, no local cargo builds.

**Future: tmux_interface crate** (`crates.io/crates/tmux_interface`) — could replace the manual process tracking in `rs-exec/src/runner.rs` (`active: Arc<Mutex<HashMap<...>>>`) and session cleanup code. Each exec task would run in a tmux pane, giving persistent sessions, easy kill-by-session-id, and process inspection without sysinfo scanning. Not yet implemented.

**PUBLISHER_TOKEN required** in `rs-exec`, `rs-codeinsight`, `rs-search` repos for cascade.yml to trigger rs-plugkit workflow. Set with: `gh secret set PUBLISHER_TOKEN --repo AnEntrypoint/<repo>`

**rs-plugkit CI builds**: Never run `cargo update` or `cargo build` locally. Push changes and let CI build. The `cargo update` step in CI always pulls latest git dep hashes — no Cargo.lock hash management needed locally.

**rs-plugkit release.yml binary commit**: The publish-binaries job runs `git add gm-build-latest/gm-cc/bin/`. This fails silently (exit 1) because `gm-build-latest/` is listed in gm's `.gitignore`. Must use `git add -f gm-build-latest/gm-cc/bin/` to force-add past the ignore rule.

**gm publish.yml force-add bin/**: Generated output contains a `.gitignore` with `bin/` entry (from `lib/template-builder.js:generateGitignore`). The orphan-publish step therefore needs `git add -f bin/` after `git add -A`, otherwise binaries silently drop from the downstream push and users get a plugin without plugkit binaries. Symptom: `claude plugin marketplace` refresh succeeds but bootstrap fails with "binary not found" at first hook invocation.

**Downstream orphan-commit publishing**: gm's `publish.yml` does NOT clone the downstream repo to append a commit — it `git init`s a fresh directory, rsyncs build output in, and `git push --force origin main`. Each publish replaces history entirely. No-op detection: `git clone --depth 1` the current downstream into a sibling dir and `diff -rq --exclude=.git`. If identical, skip the push. This avoids force-pushing identical trees (cosmetic churn in GitHub UI).

**exec-process-mode orphan accumulation**: On runner restart the in-memory active PID map is lost, leaving `--exec-process-mode` child processes with no cleanup path. Fix: call `reap_orphaned_exec_processes()` at server startup in `rs-exec/src/runner.rs` — uses sysinfo to find exec-process-mode procs whose parent is not a live runner-mode proc (5-second age guard) and kills them via `kill_tree`. Without this, orphans accumulate across restarts (300+ procs, ~5.9GB RAM observed).

**GitHub Pages build**: The `site/` directory is the source; `docs/bundle.js` and `docs/styles.css` are build artifacts (gitignored, generated by `.github/workflows/pages.yml`). For the workflow to deploy, GitHub Pages source must be set to **GitHub Actions** (not "Deploy from branch") in the repo Settings → Pages. Without this setting the workflow completes but nothing is served.

**site/ build stack**: Uses esbuild JS API (`site/build.js`) for bundling, `node node_modules/@tailwindcss/cli/dist/index.mjs` for CSS, and `flatspace aggregate` for platform data. Do NOT invoke `node node_modules/esbuild/bin/esbuild` — that file is a native ELF binary on Linux and will fail with "SyntaxError: Invalid or unexpected token" when node tries to execute it as JS. Use the JS API via `require('esbuild')` instead. `rippleui` (npm package `rippleui`, not `ripple-ui`) is a Tailwind v3 component library — it works with Tailwind v4 via `@import "rippleui/dist/css/components.css"` in input.css, with a non-fatal calc() warning.

**rs-search local Windows nightly builds**: Two things required simultaneously: (1) Use the nightly rustup cargo binary directly — `C:\Users\user\.rustup\toolchains\nightly-x86_64-pc-windows-msvc\bin\cargo.exe` with env `RUSTC` set to matching nightly rustc. The Chocolatey cargo.exe and default PATH cargo use stable rustc even when `RUSTUP_TOOLCHAIN` is set. (2) Set `CC=<MSVC cl.exe path>` and add its dir to `PATH` for `onig_sys` to compile, plus `INCLUDE`/`LIB` pointing to MSVC and Windows SDK headers. Also run `cargo clean` when switching between stable and nightly to avoid E0514 incompatible-artifact errors.

**ocw provider/model API shape**: From `GET /api/providers` (via opencode-core.js), provider objects are `{ id, name, source, env, options, models: { [modelId]: { id, name, ... } } }`. Display field is `.name` NOT `.label` — there is no `.label` field. Models are a dict keyed by model id; to populate a dropdown: `Object.values(provider.models || {})`.

**ocw file:// vs http:// ES modules**: ES modules loaded via `file://` origin are blocked by CORS in Chrome. The ocw app must be served over HTTP. To serve locally: `bun --smol x serve -p 3000 .` from `C:/dev/ocw`.

**ocw render() loading state leak**: `applyDiff(root, h("div", ..., "Loading…"))` puts a div inside `#root`. When `render()` later creates `.split` and appends it, the loading div persists alongside. Fix: call `root.innerHTML = ""` before appending `.split` on first mount.

**ocw rippleui CSS var format**: rippleui CSS variables like `--gray-2`, `--border`, `--content1` resolve to raw space-separated RGB tuples (e.g. `"28 28 28"`) — NOT valid CSS colors. Must be wrapped in `rgb()` or use explicit hex fallbacks. More reliable to bypass rippleui entirely for form elements using custom classes.

**ocw rippleui form class override**: `.select`, `.select-bordered`, `.input`, `.input-bordered` set background/border via CSS class rules that override inline `style=""` attributes. Solution: remove rippleui form classes entirely and use custom CSS classes (e.g. `.oc-sel`, `.oc-input`) with `appearance:none` and explicit hex colors.

**ocw PromptInput schema**: `SessionPrompt.prompt` (opencode-core.js) requires `{ sessionID: string, parts: [{type:"text", text: string}], model?: {providerID: string, modelID: string} }` — NOT a flat `{ content, provider, model }` shape. The `api.js` fetch interceptor must transform the flat body from `ui-chat.js` into this shape before calling `SessionPrompt.prompt`.

**GC plugkit exec --lang flag**: The plugkit binary's `exec` subcommand takes lang as `--lang <lang>` flag with code as positional arg. Incorrect: `spawnSync('node', [plugkitJs, 'exec', rawLang], { input: code })`. Correct: `spawnSync('node', [plugkitJs, 'exec', '--lang', rawLang, code])`. Fix in `platforms/cli-config-shared.js:createGcPreToolUseHook()` around line 1027.

**GC extension missing bin/**: The GC Gemini extension at `~/.gemini/extensions/gm/` was missing `bin/plugkit.js` and native binaries. The pre-tool-use-hook.js references `path.join(__dirname, '..', 'bin', 'plugkit.js')` — must copy `build/gm-gc/bin/` to `~/.gemini/extensions/gm/bin/` after building.

**CC hook enforcement architecture**: Two JS hook files in CC build output (`hooks/`) flank the plugkit binary hooks. `hooks/prompt-submit-hook.js` (UserPromptSubmit) writes `.gm/needs-gm` sentinel to cwd and emits a systemMessage demanding `Skill("gm")` as the first tool call. `hooks/pre-tool-use-hook.js` (PreToolUse) blocks every tool except `Skill(gm)` while the sentinel exists, and clears it when `Skill(gm)` fires. It also reads `.gm/lastskill` and blocks `Write`/`Edit`/`NotebookEdit` when lastskill is `gm-complete` or `update-docs` (phase guard against post-emission mutation). Source: `platforms/cli-config-shared.js` `createCcPromptSubmitHook()` / `createCcPreToolUseHook()`, plus the CC `buildHooksMap()` override. `.gm/lastskill` is written by both pre-tool-use-hook.js and session-start-hook.js. **Important**: gm-first requires (1) Skill(gm) as the first tool call AND (2) zero response-level text before the tool invocation block. The hook enforces (1); response discipline enforces (2). Never narrate "I'll invoke gm now" before the tool block.

**OC/Kilo lack PreToolUse parity**: OpenCode and Kilo plugin SDKs only fire `message.updated` (prompt) and `session.closing` (stop). There is no `tool.execute.after` equivalent. The `execCallsSinceMemorize` post-tool counter that cc/codex/copilot-cli use to enforce memorize cadence cannot increment in oc/kilo — only `tool.execute.before` checks (sentinel, phase-guard, Skill(gm) bypass) run there. Adding cadence enforcement requires a different mechanism (e.g. inspecting prior tool history inside tool.execute.before, or piggybacking on message.updated).

**memorize sub-agent platform coverage**: `memorize.md` ships in build outputs for cc, codex, oc, kilo, copilot-cli, and gc — NOT qwen or hermes. Agent-driven memory features are silently absent from qwen/hermes builds.

**Kilo plugin install location**: ~/.kilocode/ — needs gm-kilo.mjs, kilocode.json, agents/, hooks/. Skills dirs exist as empty dirs and cannot be written to (Windows junction issue) — skip skills copy. Core plugin still functional.

**Validation harness**: `validate/probe.js` in plugforge root runs 14 scenarios against OC and GC hook scripts. Run with `node validate/probe.js` from project root. Validates hook behavior across both platforms — use before committing hook-related changes.

**rs-search PDF ingestion**: `.pdf` files are indexed page-by-page via the `pdf-extract` crate (pure rust, no C deps, builds under MSVC nightly alongside oniguruma). Scanner dispatches on extension in `src/scanner.rs` → `src/pdf.rs::pdf_chunks`, producing one Chunk per page with `line_start = line_end = page_number`. Extracted pages cache to `.code-search/pdf-cache/<hash>.json` keyed by abs-path + mtime — invalidates automatically on file change. Encrypted, scanned-only, or malformed PDFs yield zero chunks silently; `pdf-extract` does not do OCR. `.pdf` is now in `CODE_EXTENSIONS` and removed from `BINARY_EXTENSIONS` in `src/ignore.rs` — both changes are required for PDFs to pass `should_ignore`. Skills (`code-search`, `planning`, `gm-execute`, `gm-emit`, `gm-complete`) document PDFs as first-class searchable artifacts; cite PDF hits as `path/to/doc.pdf:<page>`.

**Write-hook forbids three file classes**: `rs-plugkit/src/hook/pre_tool_use.rs` `handle_bash` Write branch blocks three categories outside `skills/` paths (which bypass via `in_skills` guard): (1) docs — `.md`/`.txt` outside the allowlist; (2) tests — `.test`/`.spec`/`__tests__`/`fixtures`; (3) smoke pages — `is_smoke_page(base, fp)` matches `smoke.{js,html,mjs}`, `smoke-*.js`, `*-smoke.*`, `docs/test.html`, `docs/demo.html`, `docs/sandbox.html`, `*-playground.html`, `docs/playground.*`. Canonical project-root `test.js` is allowed via early return. Smoke-page block message redirects to `window.__debug.<moduleName>` registry per paper II §5.4 (single live structured registry). Smoke pages are smuggled second test runners that violate the single-integration-test policy.

**Refusal IS forced closure**: Refusal preambles ("Honest stop —", "Stopping for a hard, honest call", "I cannot do this from inside this conversation", "pretending I can would be the most expensive kind of lie") are forbidden by paper III §2.5 Earned Emission. Lawful downgrade to a witnessable bounded subset is always available; forced closure never is. Enforced in `gm-starter/skills/gm/SKILL.md` and `skills/planning/SKILL.md` LAWFUL DOWNGRADE sections, plus `prompts/prompt-submit.txt` REFUSAL BAN section.

**rs-exec RPC session isolation**: Every task RPC method in `rs-exec/src/rpc.rs` (`getTask`, `deleteTask`, `listTasks`, `getAndClearOutput`, `waitForOutput`, `appendOutput`, `sendStdin`, `pm2list`) must validate `sessionId` and enforce task ownership. `listTasks()` filters by session, not system-wide. Skipping the check leaks tasks across Claude Code agent sessions.

## GitHub Automation Workflows

**7 fully-automated GitHub Actions workflows publish metrics to docs/api/ JSON endpoints:**

Workflows: `track-stars.yml` (daily stargazer count), `metrics-badges.yml` (weekly commits/week, issues, contributors, PR merge time badges), `releases-changelog.yml` (tag-triggered conventional commit changelog), `pr-stats.yml` (PR comment with files/lines/review-time), `insights.yml` (weekly top reviewers/files/PR velocity), `publish-releases-api.yml` (releases list), `notify-failures.yml` (workflow failure GitHub issue posts).

Infrastructure: `docs/api/` holds 4 JSON endpoints (stars.json, metrics.json, insights.json, releases.json), each initialized with placeholder `{}`. `docs/stats.html` is a 381-line live-updating dashboard (Chart.js, client-side rendering, auto-refresh toggle) fetching from `/docs/api/`.

**Non-obvious patterns:**
- Placeholder API files MUST exist before workflows run — workflows append/update, not create from scratch. Manually create each JSON file with `{}` before deploying workflows.
- GitHub Pages must be set to deploy from "GitHub Actions" (not "Deploy from branch") in Settings → Pages. Without this, site/ artifacts (docs/bundle.js, docs/styles.css, generated by pages.yml and gitignored) are never served.
- All workflows idempotent — only commit if data changed. Scheduled workflows run even on unchanged data; compare new vs existing before committing to avoid noise.
- All workflows use pure bash/Python (no npm), github.token for auth, env vars for config, no hardcoded values. Bot filtering list: dependabot, renovate, github-actions, snyk, etc.

**jq rejects `\`` as invalid JSON escape**: Inside jq string literals, backticks are ordinary characters and need no escaping. Attempting `\`` produces `jq: error: Invalid escape` and exits 3. Only JSON-spec escapes (`\n`, `\t`, `\"`, `\\`, `\/`, `\b`, `\f`, `\r`, `\uXXXX`) are valid. In shell heredocs with jq templates (especially `-n` mode), write backticks unescaped. Applies to any jq `--arg` template builder in shell — relevant to `.github/workflows/notify-failures.yml`.

**workflow_run trigger requires explicit workflows list**: `on: workflow_run: types: [completed]` WITHOUT a `workflows:` key produces chronic "workflow file issue" 0s failures on every push to main. Symptoms: `gh run list` shows repeated 0s failures with event=push and 0 jobs on the API response. The trigger registers but cannot resolve which runs to listen to, so GitHub treats each push as a failed invocation. Fix: add `workflows:` with explicit workflow names (display names from `name:` field, not filenames). Wildcards not supported. Example in gm's `.github/workflows/notify-failures.yml`.

**pr-stats.yml shows cosmetic 0s push failures despite `on: pull_request` only trigger**: workflow declares `env: PR_NUMBER: ${{ github.event.pull_request.number }}` at the step level. On push events that context key does not exist, and GitHub creates a failed "workflow file issue" run record even though the workflow should not match at all. Adding `if: github.event_name == 'pull_request'` at the job level does NOT prevent the startup failure (the issue is pre-job parse-time, not job selection). Real PR triggering still works — failures are cosmetic noise in `gh run list`. A proper fix would remove the step-level env referencing pull_request context entirely and read `GITHUB_REF`/`GITHUB_EVENT_PATH` inside the step only when `GITHUB_EVENT_NAME=pull_request`.

**pm2list / daemon pid-check**: `daemon::is_alive()` in `rs-exec/src/daemon.rs` must check the target PID only via `ProcessesToUpdate::Some(&[pid_val])`, NEVER `refresh_processes(All, false)`. The full scan takes 1–5s per call on Windows; doing it once per `.pid` file blows the 15s exec window and `pm2list` backgrounds as a dangling task.

**Runner port file**: The runner TCP port is written to `$TMPDIR/glootie-runner.port` (not `plugkit-runner.port`). The RPC path is `/rpc`, body `{ method, params }`, response `{ result }`. Session ID must be provided for all task/process queries or runner returns empty results.

**.gitignore re-include past parent-dir ignore is impossible**: Per the gitignore manual: "It is not possible to re-include a file if a parent directory of that file is excluded." If `.gm/` is ignored and you write `!.gm/rs-learn.db` after it, the negation has no effect and the file remains untracked. Workaround: enumerate the `.gm/*` files and subdirs to ignore individually instead of ignoring the whole directory. Applied in gm and rs-learn `.gitignore` so `.gm/rs-learn.db` (cross-session memory) can be tracked. Symptom of the bug: `git check-ignore -v .gm/rs-learn.db` returns `.gitignore:N:.gm/` (the parent rule wins).

**rs-learn DB path resolution unified**: `src/db_path.rs::resolve_db_path()` is the single source — checks `RS_LEARN_DB_PATH` env, otherwise prefers `<cwd>/.gm/rs-learn.db`, migrates legacy `<cwd>/rs-learn.db` via rename when `.gm/` is creatable, falls back to root path on read-only checkouts. Both `src/main.rs::open_graph()` (used by add/search/query) and `src/orchestrator/mod.rs::Orchestrator::new_default()` (used by query ACP path) now call it. Previously only orchestrator had the migration; main.rs hardcoded `./rs-learn.db`, so add/search wrote to project root while query wrote to `.gm/`.

## Made with gm Page

`docs/made-with.html` is a static showcase of notable AnEntrypoint projects. Update the PROJECTS array in that file whenever a new notable project is added to the org — projects with interesting descriptions, meaningful star counts, or technically unusual scope. Data is static (no runtime API calls). The file is standalone HTML, not bundled.
