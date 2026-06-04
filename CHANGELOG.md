## 2026-05-21 - browser launches headed by default

`gm-starter/gm-plugkit/plugkit-wasm-wrapper.js::startManagedBrowser` drops the hardcoded `--headless` arg from the runner invocation. The launched browser is visible by default; `GM_BROWSER_HEADLESS=1` opts into headless. Same patch lands in `~/.claude/gm-tools/plugkit-wasm-wrapper.js` for the deployed copy. The user can always see the window the agent spawned.

## 2026-05-21 - observability + supervisor + browser-name scrub

gmsniff and ccsniff CLI tools (`bin/gmsniff.js`, `bin/ccsniff.js`, mirrored under `gm-starter/bin/`) implement the observability surface AGENTS.md documented but that did not ship. gmsniff flags: `--embed-failures`, `--recall-misses`, `--recall-scores`, `--classifier-rejects`, `--memory-leverage`, `--recall-modes`, `--table-drops`, `--discipline-sigil-ignored`, `--since <Ns|Nm|Nh|Nd>`. ccsniff flags: `--git-discipline`, `--learning-xref`. Both pipe-friendly, no external deps, tolerate missing logs. `gm-starter/bin/plugkit-supervisor.js` separates supervision from the wasm watcher: monitors `.status.json` mtime, SIGTERMs the child on stale heartbeat with `.shutdown-reason.json` writeback, exponential backoff respawn (2s->30s cap), single-instance guard via `.supervisor.pid`. `gm-starter/lib/skill-bootstrap.js::spawnPlugkitWatcher` routes through the supervisor; `ensureNextStepWiring` seeds `.gm/next-step.md` plus `CLAUDE.md`/`AGENTS.md` `@-include` lines on every bootstrap so the file the harness expects always exists. `gm-starter/gm-plugkit/plugkit-wasm-wrapper.js`: auto-recall TTL cache (30s) and skip-fallback-on-primary-hit eliminate doubled BertModel.forward on turn entry; 10s slow-backoff disables the path for 5 min after a slow firing. Browser tooling renames remove playwright/puppeteer/playwriter from agent-facing surfaces: `findPlaywriter`->`findBrowserRunner`, `runPlaywriter`->`runBrowserRunner`, `PLAYWRITER_BROWSER_{PATH,KEY}`->`GM_BROWSER_RUNNER_{PATH,KEY}` with back-compat reads, scrub regex broadened to all three names. `watcher.silent-abort` now writes `.silent-abort-forensics.json` snapshotting `prior_verb_active`, `prior_status`, OS-level `prior_pid_alive` probe so gmsniff can correlate external kills.

## 2026-05-17 - WASM-only conversion: native plugkit retired, single wasm32-wasip1 artifact

All 5 Rust crates (rs-plugkit, rs-exec, rs-search, rs-codeinsight, rs-learn) converted to WASM-only cdylib. Native binaries no longer built or published. `plugkit.exe` retired; replaced by `plugkit.wasm` (~150KB) loaded by `plugkit-wasm-wrapper.js` running under node or bun. JS host implements 15 host functions: host_fs_* (read/write/exists/mkdir/readdir/stat/remove), host_kv_* (get/set/delete/list), host_fetch, host_exec_js, host_vec_search, host_vec_embed, host_env_get, host_log, host_now_ms (host_browser_* deleted in followup). Orchestrator FSM (PLAN->EXECUTE->EMIT->VERIFY->COMPLETE) reachable from wasm `dispatch_verb`; pkfs abstraction routes std::fs through host_fs_* under wasm32. Cascade pipeline: any rs-* repo push -> rs-plugkit release.yml builds wasm -> publishes to plugkit-bin Releases + npm `@anentrypoint/plugkit-wasm` -> `gm.json::plugkitVersion` + sha256 manifest auto-bumped. 6-target test matrix in rs-learn collapsed to single wasm32-wasip1 build. 5 npm platform packages (`@rs-codeinsight/*`) replaced by single `@anentrypoint/rs-codeinsight-wasm`.

## 2026-05-17 - orchestrator-in-plugkit migration; gm-skill becomes canonical harness

gm state machine (PLAN->EXECUTE->EMIT->VERIFY->COMPLETE) migrated into rs-plugkit at `rs-plugkit/src/orchestrator/{mod,state,transitions,mutables,memorize}.rs`. plugkit exposes four new verbs: `transition`, `mutable-resolve`, `memorize-fire`, `phase-status`. All harnesses delegate phase/mutables/memorize logic to plugkit rather than reimplementing it skill-side. Skills collapse to 1-line spool-dispatch stubs that call the corresponding plugkit verb. gm-starter/skills/gm-skill/SKILL.md becomes the canonical universal harness body; the 10 platform-specific skills (gm-cc, gm-gc, gm-oc, gm-codex, gm-kilo, gm-copilot-cli, gm-vscode, gm-cursor, gm-zed, gm-jetbrains) become thin re-export wrappers with zero divergent orchestration prose. Tool surface across all skills reduced to `Skill, Read, Write` -- Write permitted only for spool dispatch. Code execution, git, browser, recall, memorize, codesearch all route through `.gm/exec-spool/` and are serviced by plugkit verbs.

## 2026-05-17 - consolidation: skill cache via TemplateBuilder inheritance

Eliminated 8x skill file duplication across bundled platforms (cc, oc, kilo, codex, copilot-cli, vscode, cursor, zed) via TemplateBuilder inheritance chain. TemplateBuilder.loadSharedSkills(sourceDir) reads 4 core skills (gm, gm-execute, gm-emit, gm-complete) once, caches in Map. TemplateBuilder.selectBundledSkills(platformName) identifies bundled platforms; AutoGenerator loads shared skills before platform loop and passes cache to each bundled adapter. Platform constructors accept optional `skillsCache` parameter; loadSkillsFromSource() uses cache when available, falls back to disk read for external-skill platforms (gc, qwen, hermes, thebird, antigravity, windsurf, jetbrains). TemplateBuilder.mergeSkillMetadata(skillContent, platformName) prepared for future per-platform overrides without re-duplication. Verified: all 15 platforms build, all 4 core skills remain byte-identical across 8 bundled platforms post-consolidation. Benefit: single parse + reuse vs 8 independent read operations. Extensibility: metadata merge path available for platform-specific tweaks.

## 2026-05-14 - gm-skill: daemon-bootstrap.js for standalone daemon orchestration

gm-skill now provides gm-skill/lib/daemon-bootstrap.js, a standalone daemon orchestration module with zero plugkit dependency. Exports five functions: `checkState(daemonName)` detects running daemons via platform-specific mechanism (tasklist on Windows, pgrep on Unix); `spawn(daemonName, cmd)` spawns detached daemons via bun; `waitForReady(daemonName, host, port, timeoutMs)` polls socket reachability with configurable timeout; `getSocket(daemonName)` retrieves socket address from status file; `shutdown(daemonName)` kills daemon process tree. All functions emit JSONL events to ~/.claude/gm-log/<date>/daemon.jsonl and write status JSON to ~/.gm/<daemon>-status.json. Graceful error handling on missing/stale daemons, no unhandled rejections. Works in exec:nodejs spool contexts without hook infrastructure. Enables gm-skill to manage acptoapi, rs-learn, and rs-codeinsight daemons independently of plugkit. Updated gm-skill/index.js to import from lib/ (not gm-starter/); updated package.json to export "./daemon-bootstrap": "./lib/daemon-bootstrap.js" for direct import paths.

## 2026-05-14 - gm-skill: automated npm publish with version bump

Created `.github/workflows/gm-skill-publish.yml` to automatically publish gm-skill to npm on every push to main. Workflow: (1) checks current gm-skill/package.json version vs npm registry; (2) auto-bumps patch version if npm published version is >= local (e.g., 0.0.0 npm -> 0.1.0 local bumps to 0.1.1); (3) commits and pushes version bump if needed with `[skip ci]` marker; (4) publishes to npm with `--access public` using NODE_AUTH_TOKEN from GitHub secrets.NPM_TOKEN; (5) on success, triggers 12-platform rebuild via `gh workflow run publish.yml` to cascade gm-skill updates to all downstream repos (gm-cc, gm-gc, gm-oc, gm-kilo, gm-codex, gm-qwen, gm-copilot-cli, gm-hermes, gm-antigravity, gm-vscode, gm-cursor, gm-zed). Conditional triggers on `paths: ['gm-skill/**', '.github/workflows/gm-skill-publish.yml']` to avoid spurious runs. Resolves user request "make sure it bumps the version and publishes on every push".

## 2026-05-14 - gm-skill: spool dispatch helpers and test coverage

gm-skill npm package now exports comprehensive spool dispatch API via `const { spool } = require('gm-skill')`. Four helpers: `writeSpool(body, lang, options)` writes code to `.gm/exec-spool/in/<lang>/` and returns task metadata; `readSpoolOutput(id)` reads completed task stdout/stderr/metadata from `.gm/exec-spool/out/`; `waitForCompletion(id, timeoutMs)` polls for task completion with configurable timeout; `getAllOutputs()` enumerates all completed tasks. Platform-aware paths (Windows/POSIX), graceful error handling on missing files, zero mocks. gm-skill/test.js exercises all four helpers with real filesystem operations over 90 lines under the 200-line budget. Enables npm consumers (freddie, downstream agents, third-party tools) to dispatch work via the gm spool without reimplementing file I/O.

## 2026-05-14 - hooks: skill-based gate logic via .gm/ markers

All 5 hooks (session_start, pre_tool_use, prompt_submit, post_tool_use, session_end) implement skill-driven gate logic reading marker files and YAML state. session_start writes `.gm/needs-gm` when `.gm/` folder exists. prompt_submit manages needs-gm based on PRD existence -- if `.gm/prd.yml` exists (autonomous work), needs-gm is written; if absent, needs-gm is deleted. pre_tool_use denies tool use if gm is needed but `.gm/gm-fired-this-turn` marker absent (lines 89-99, 140-142); on Skill(gm:gm) or Agent(subagent_type="gm:gm"), writes the marker (lines 106-127). Mutables gate (lines 178-191) reads `.gm/mutables.yml` via `scan_unresolved_mutable_ids()` and denies Write/Edit/git if any entry has `status: unknown`. prompt_submit deletes `.gm/gm-fired-this-turn` at turn start (line 46) to reset. post_tool_use tracks turn state in `.gm/turn-state.json`. session_end on real-exit cleans up tasks and browsers. Together: PRD exists -> needs-gm written -> Skill(gm:gm) required -> gm-fired marker gate clears -> mutables gate checks YAML resolution -> skill chain proceeds.

## 2026-05-14 - bootstrap: skill-bootstrap.js completed

gm-starter/lib/skill-bootstrap.js now provides shared bootstrap orchestration for all 10 output skills. Detects plugkit binary at ~/.claude/gm-tools/plugkit{.exe,}, verifies SHA256 against manifest (gm.json::plugkitVersion + bin/plugkit.sha256), downloads from AnEntrypoint/plugkit-bin Releases on mismatch, kills stale processes before re-spawn on Windows (honoring EBUSY precedent), spawns daemon in detached mode with stdio:'ignore', and emits structured JSONL events to ~/.claude/gm-log/<date>/bootstrap.jsonl. Returns Promise<{ ok, error? }> for graceful error handling in skill setup. Removed abandoned refactoring modules (plugkit-platform.js, plugkit-manifest.js) created during failed modularization attempt--skill-bootstrap.js remains single coherent concern.

## 2026-05-14 - platform skill manifests: AgentSkills.io compliance

gm-starter/skills/gm/SKILL.md + 9 platform-specific manifests (gm-cc through gm-jetbrains, excluding gm-gc per design) ship with AgentSkills.io frontmatter: name, description, allowed-tools=[Skill]. TemplateBuilder.loadSkillsFromSource emits manifests to build/gm-<platform>/skills/<name>/SKILL.md during build. No skill duplication across platforms; each platform gets its own directory. Manifests enable downstream tooling (claude.ai Routing, agent discovery, skill marketplaces) to introspect available skills without parsing internal prose.

## 2026-05-12 - bootstrap: kill-before-rename on busy gm-tools targets

Fixed silent stale-binary loop where `gm-starter/bin/bootstrap.js::copyToGmTools` swallowed `EBUSY`/`EPERM`/`EEXIST` on `renameSync(plugkit.exe.new -> plugkit.exe)` and trusted an in-Rust self-update that the same hold-open also blocked. Result: bootstrap returned ok, but `plugkit.js::isReady()` sha-checked the stale `plugkit.exe`, mismatched the manifest, and emitted `[plugkit] bootstrap failed; aborting hook` on every prompt-submit. Orphan `plugkit.0.1.*.new` files accumulated across days.

`copyToGmTools` now (a) sweeps stale `*.new` orphans before writing, (b) retries the atomic rename up to 8 times with 200 ms backoff, (c) at the halfway attempt enumerates Windows processes whose `ExecutablePath` is the target via `wmic` and terminates them with `taskkill /F`, (d) throws on exhausted retries instead of swallowing. The top-level `.catch` now writes `.gm/exec-spool/.bootstrap-error.json` alongside the JSONL `fatal` event so the documented spool sentinel surfaces this failure mode. Generalises the AGENTS.md "kill before rmSync" rule to in-place overwrite-rename of binaries held open by concurrent plugkit invocations.

## 2026-05-10 - verb-spool migration: Bash retains only git + utility verbs

Code execution (nodejs, python, bash, typescript, go, rust, c, cpp, java, deno) routes through the file-spool exclusively. The Bash tool accepts git commands and utility verbs (`exec:recall`, `exec:codesearch`, `exec:memorize`, `exec:wait`, `exec:sleep`, `exec:browser`, `exec:runner`, `exec:type`, `exec:kill-port`, `exec:forget`, `exec:feedback`, `exec:learn-status`, `exec:learn-debug`, `exec:learn-build`, `exec:discipline`, `exec:pause`, `exec:status`, `exec:close`); everything else is a spool write to `.gm/exec-spool/in/<lang>/<N>.<ext>` and the watcher emits `out/<N>.json` as systemMessage.

Updated: `gm-starter/prompts/bash-deny.txt` (canonical denial text), `gm-starter/skills/{gm,gm-execute,gm-emit,gm-complete,update-docs,planning}/SKILL.md` (replaced literal `exec:nodejs`/`exec:bash` code blocks with spool-form, kept utility-verb examples). Companion changes in rs-plugkit (BASH_DENY_MSG sync, memorize gate threshold 3->10, .gm/no-memorize-this-turn write always passes, mutables.yml/prd.yml writes excluded from counter) at rs-plugkit d8aa393, and in rs-exec (`UTILITY_LANGS` gains wait/pause/browser/feedback, ext fallback for root-level `in/<N>.<ext>` files) at rs-exec 1238e35.

## 2026-04-30 - memorize agent: scope guard against out-of-reach AGENTS.md edits

`gm-starter/agents/memorize.md` now opens with a STEP 0 reach check. Before reading or editing `<cwd>/AGENTS.md` (Step 3) or running the AGENTS.md <-> rs-learn migration audit (Step 4), the agent runs `gh api repos/<owner>/<repo> --jq .permissions.push` against the cwd's `git remote get-url origin`. If the answer is anything other than literal `true` (out-of-reach), the agent skips Step 3 and Step 4 entirely. rs-learn ingest (Step 2) still runs unconditionally -- it's a per-user store, safe regardless of repo ownership.

Why: agents running in a cwd that points at a third-party repo (e.g. `nousresearch/hermes-agent` for a downstream port) were writing project-specific porting notes into the upstream project's AGENTS.md. The upstream maintainers do not want those notes; the user has no push rights to land them; the changes piled up as local-only drift. Reach check is the same authoritative gate that rs-plugkit's stop hook now uses for push-pressure (`fix(stop-hook): skip push-pressure on out-of-reach remotes`, rs-plugkit 72a53da).

Recall key: `feedback/memorize-scope-guard`.

## 2026-04-30 - Maximal Cover: self-authorize in-spirit residuals

Maximal Cover rule (AGENTS.md + planning SKILL.md + gm SKILL.md) loosened: residuals the agent judges within the spirit of the original ask AND completable from this session are self-authorized -- agent expands the PRD and executes without re-asking. Only residuals genuinely outside the original ask OR genuinely unreachable are name-and-stop. When expanding under self-authorization, the agent declares its judgment in-response ("treating X as in-scope because Y") so the user can correct mid-chain. Silent expansion without the declaration is the failure mode this rule guards against.

Trades a one-message round-trip per discovered subset for the agent's honest read of intent. The transparency clause keeps misjudgments correctable in the same conversation. Propagates to all 12 downstream repos via `gm publish.yml` cascade. Recall key: `project/maximal-cover-self-auth`.

## 2026-04-30 - hook-spec lifted into per-repo hooks/hooks.spec.json

Each generated CLI repo (gm-cc, gm-gc, gm-codex, gm-oc, gm-kilo, gm-qwen, gm-copilot-cli) now ships its own `hooks/hooks.spec.json` next to the rendered `hooks.json`. The spec is the canonical configuration; hooks.json is the platform-targeted render that buildHooksJson(spec) produces. Downstream tooling can read the spec to introspect this repo's plugkit setup without parsing platform-specific hooks.json shapes.

Spec format: `{schemaVersion: 1, description, envVar, plugkitInvoker?, events: [{eventKey, wrapMode?, commands: [{kind:'plugkit'|'js', subcommand|file, timeout, subcommandRename?}]}]}`. Renamed every platform's `buildHooksMap()` override to `buildHookSpec()` returning the spec object directly. cli-adapter.generateHooksJson runs buildHooksJson(spec).hooks for the rendered output and emits the spec verbatim as hooks.spec.json.

test.js now asserts spec presence and roundtrip equality (spec -> buildHooksJson -> must match hooks.json bytes) for all 7 platforms; future drift between spec and rendered output fails CI.

## 2026-04-30 - hook-spec descriptor unification

7 platforms (cc, gc, codex, oc, kilo, qwen, copilot-cli) had drifted into 7 hand-written `buildHooksMap()` overrides spread across `platforms/cli-config-shared.js` and `platforms/copilot-cli.js`, plus a coexisting `TemplateBuilder.buildHooksMap` and `lib/hook-builder.js::buildHooksMapCustom` that were no longer the source of any output. Adding a platform required learning every dimension by reading the existing examples.

Collapsed into one `lib/hook-spec.js::buildHooksJson(spec)` (51L). Each platform now declares `{envVar, plugkitInvoker: 'node'|'binary', wrapMode: 'wrapped'|'flat-matchers', events: [{eventKey, commands: [{kind:'plugkit'|'js', subcommand|file, timeout, subcommandRename?, wrapMode?}]}]}`. Substitutes env-var placeholders, picks plugkit prefix shape (cc/codex/oc/kilo/qwen use `node ${env}/bin/plugkit.js hook`, copilot uses bare-binary `${env}/bin/plugkit hook`), and emits the matcher wrapper. qwen's per-command flat-matcher quirk and copilot's stop->session-end / stop-git->session-end-git renames are encoded as data, not code.

All 7 generated `hooks.json` byte-identical to baseline. Deleted: `lib/hook-builder.js`, `TemplateBuilder.buildHooksMap`, `TemplateBuilder.createCommand`, `TemplateBuilder.buildHookCommandWithEnv`, `CLIAdapter.buildHookCommand`, `CLIAdapter.createCustomCommand`. New platform = one `buildHooksMap()` override returning `buildHooksJson(spec).hooks`.

## 2026-04-24 - ccsniff compliance audit + stop-hook isMeta fix

ccsniff audit across 6 sessions (rs-learn, agentgui, guru-gcs, thebird, diagen, voice):

**Root causes identified:**
- Dominant violation (87% of non-compliant turns): stop-hook feedback messages have isMeta:true, bypassing UserPromptSubmit hook. Pre-tool-use sentinel never written -> model responds with Bash directly.
- Secondary (8%): Skill(gm:planning) called directly instead of Skill(gm) -- already blocked by pre-tool-use (only gm/gm:gm clears needs-gm).
- Minor (5%): compaction/session-continued messages similarly bypass hook.

**Fix (rs-plugkit):** write_needs_gm() called before every block decision in run_stop(), run_stop_git(), and run_stop(). Also write_needs_gm() in pre_compact run(). Pre-tool-use hook then enforces gm-first even for isMeta-triggered responses.

**True compliance rate (excluding isMeta/hook/compact):** ~80-85% across sessions.

## 2026-04-24 - PostToolUse hook + stronger memorize/narration enforcement (ccsniff-driven)

ccsniff audit (7d, gm sessions): 145 narrate-before-tool violations, 41/74 turns starting with text (not tool), 0 actual memorize Agent spawns despite 51 text mentions. Fixes:

- `gm-starter/hooks/post-tool-use-hook.js`: rewritten -- stdin fd 0 fix, memorize reminder injected after every Bash exec: completion
- `gm-starter/hooks/hooks.json`: added PostToolUse entry wiring post-tool-use-hook.js
- `platforms/cli-config-shared.js`: added `PostToolUse` to CC `buildHooksMap()`, added `createCcPostToolUseHook()`, wired into `getAdditionalFiles()`
- `rs-plugkit/src/hook/prompt_submit.rs`: memorize rule strengthened -- exact invocation syntax, parallel spawn mandate, explicit anti-patterns ("saying you will memorize != memorizing")
- `rs-plugkit/src/hook/pre_compact.rs`: added memorize self-check section to post-compact reminder

## 2026-04-24 - rs-plugkit prompt_submit upgrade: systemMessage + memorize/no-narration enforcement

- `rs-plugkit/src/hook/prompt_submit.rs`: switched CC output from `additionalContext` to `systemMessage` -- injected into system prompt (stronger) instead of system reminder (weaker)
- Added memorize-on-resolution rule to prompt_submit message: explicit trigger contract, `Agent(subagent_type='gm:memorize')` invocation pattern, end-of-turn self-check mandate; directly targets `missing-memorize-on-unknown` as dominant ccsniff violation (57% compliance -> fix)
- Added no-narration-before-execution rule: blocks describe-then-do pattern; directly targets `narrative-before-execution` as secondary ccsniff violation
- CI cascade: rs-plugkit push -> binary rebuild -> gm publish -> all 12 downstream plugins updated automatically

## 2026-04-24 - gm-first enforcement + state machine phase guards

- New `hooks/prompt-submit-hook.js` (CC): writes `.gm/needs-gm` sentinel on every prompt; injects systemMessage demanding gm invocation and subagent parallelism as the first action.
- Updated `hooks/pre-tool-use-hook.js` (CC + gm-starter): blocks any non-Skill tool if `.gm/needs-gm` exists; clears sentinel when `Skill(gm)` is invoked; blocks `Write`/`Edit`/`NotebookEdit` in `gm-complete` and `update-docs` phases (prevents file mutations after emission).
- CC `buildHooksMap` override in `platforms/cli-config-shared.js`: generates hooks.json with plugkit binary + JS hook for both `UserPromptSubmit` and `PreToolUse`; fixes `Stop` timeouts (stop=15s, stop-git=180s -- was inverted 300s/60s causing 3m20s session-end hang).
- ccsniff 48h analysis: 57% compliance across 23,746 messages; dominant violation = `missing-memorize-on-unknown` (agent finds/fixes facts but doesn't spawn memorize in same turn); secondary = `narrative-before-execution` (agent describes intent before running tool). Both are now actively enforced via hooks.

## 2026-04-23 - ccsniff + gm skillset alignment

- New `ccsniff-gm-lint.js`: optional linting module that analyzes conversation transcripts against gm tier-0 rules. Detects missing-skill-invocation, missing-memorize-on-unknown, bash-direct violations, narrative-before-execution. Produces JSON report for compliance auditing. Tested against 54 recent assistant messages: 98% compliance with gm skillset (49/50 conformant, 1 missing-skill edge case). Tool ready for integration into pre-commit hooks and agent training workflows.
- Updated AGENTS.md with ccsniff compliance audit findings.

## 2026-04-22 - Paper III published

- New `docs/paper3.html` -- "Governance, Earned Emission, and the Remote-Execution Boundary" -- covers 197 commits since paper II (2026-04-12): the governance layer (7 route families, 4 state planes, 16-mode taxonomy, DeltaS/lambda/epsilon/Coverage metrics, 8-case stress suite, 5 refused collapses); `git push` as remote-execution event with mandatory CI watch; catalogue of 4+1 parse-time CI failure modes (block-scalar heredoc indentation, missing token env, concurrent-push races, gitignored outputs, multiline output expansion); same-turn memorize discipline with end-of-turn self-check.
- Added paper3 nav links across paper.html, paper2.html, made-with.html, stats.html, site/main.js.

## 2026-04-22 - Governance layer in skill chain

- New `governance` skill: encodes route discovery (7 route families), weak-prior bridge, legitimacy gate (earned specificity / lawful downgrade), 16-failure taxonomy, 4 state planes (route_fit / authorization / repair_legality / hidden_decision_posture), DeltaS/lambda/epsilon/Coverage quality metrics, and 8-case governance stress suite (M1/F1/C1/H1/S1/B1/A1/D1).
- `planning` skill: route_family tagging + failure-mode mapping required on `.prd` items with emission impact; .prd YAML schema gains `route_family`, `failure_modes`, `route_fit`, `authorization`; competing routes kept live until witnessed dominance.
- `gm-execute` skill: weak-prior bridge -- hypotheses from PLAN arrive as weak priors, never as authorization; witnessed probe required before `authorization=witnessed`. Quality metrics DeltaS=0 / lambda>=2 / epsilon intact / Coverage>=0.70 gate UNKNOWN->KNOWN transition.
- `gm-emit` skill: legitimacy gate prior to pre-emit -- earned specificity, repair legality, lawful downgrade preferred over forced closure, live-alternative preservation. Five refused collapses enumerated in gate conditions.
- `gm-complete` skill: `stress_suite_clear` + `hidden_decision_posture=closed` added as completion mutables; hygiene sweep step 15 walks finished change through the 8 stress cases.
- Built to all 10 platforms (gm-cc/gc/oc/codex/kilo/qwen/hermes/vscode/cursor/copilot-cli/jetbrains).

## 2026-04-18 - Localize CDN imports in platform GH Pages

- Replaced rippleui@1.12.1 CDN link (4.7MB) with Tailwind CDN play script (~100KB, processes classes on-the-fly)
- Inlined webjsx@0.0.42 bundle (16KB) directly into page template -- eliminates importmap + CDN dependency
- Platform pages now fully self-contained, no external asset fetches required for rendering

## 2026-04-18 - Fix Fragment/function-component crash in platform pages

- Fixed `Invalid element name` crash in all 12 platform GH Pages sites caused by webjsx not supporting function components passed to `h()` or `Fragment` wrapper in `App`
- `page-generator.js`: replaced destructured component calls with plain function calls, removed Fragment import, inlined `applyDiff` call with array of section results
- Added GH Pages workflow (`pages.yml`) + enabled GH Pages for 8 repos that were missing it: gm-hermes, gm-codex, gm-copilot-cli, gm-qwen, gm-vscode, gm-cursor, gm-zed, gm-jetbrains

## 2026-04-17 - PDF search across skills

- Propagated "PDFs searchable as code" capability through skills: code-search, planning, gm-execute, gm-emit, gm-complete.
- AGENTS.md: new caveat documenting rs-search PDF ingestion (pdf-extract crate, pdf-cache dir, ignore.rs changes).

## 2026-05-14 - rs-plugkit: track acptoapi process PID for session cleanup

Added PID tracking for dynamically spawned acptoapi daemon process. `session_start.rs::spawn_acptoapi_daemon()` now captures and returns the child process ID (u32) instead of discarding it. On successful spawn, the PID is written to `~/.claude/gm-tools/.acptoapi-pid`. `session_end.rs::kill_acptoapi_if_running()` reads the PID file, logs a cleanup event via `rs_exec::obs::event()`, and calls `rs_exec::kill::kill_tree()` to terminate the process tree. Cleanup runs on real-exit reasons only (clear/logout/prompt_input_exit); handoff/compaction preserves the acptoapi instance for the next session. Failure to kill (e.g., process already dead) is best-effort and does not block session cleanup.

# Changelog

## [Unreleased]
- Fix GC exec dispatch: use `plugkit exec --lang <lang> <code>` instead of positional arg (was treating lang as code)
- Deploy OC plugin (gm-oc.mjs) with all 5 handlers: session.closing, tool.execute.before, message.updated, experimental.chat.system.transform, experimental.chat.messages.transform
- Install gm-kilo plugin into ~/.kilocode: kilocode.json, gm-kilo.mjs, agents/, hooks/
- Deploy GC bin/ (plugkit.js + binaries) to ~/.gemini/extensions/gm/bin/
- Deploy updated GC hooks with exec dispatch to ~/.gemini/extensions/gm/hooks/
- Add validate/probe.js: 14-scenario parity harness for OC and GC hook scripts (14/14 passing)


### Fixed
- Align file-edit blocking rules across gc/kilo/oc to match cc exactly: add Edit tool to kilo/oc check, add edit_file to GC writeTools, add jest/vitest config and snap/stub/mock/fixture patterns to GC FORBIDDEN_FILE_RE, add /fixtures/ and /test-data/ to GC FORBIDDEN_PATH_RE
