# Architecture & Philosophy

gm generates 10 platform implementations from a single convention-driven source.

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

10 outputs in `build/gm-{cc,gc,oc,kilo,codex,copilot-cli,vscode,cursor,zed,jetbrains}`.

## Core Rules

**Shared memory & search index are tracked, never ignored**: `.gm/rs-learn.db` and `.gm/code-search/` are committed so memory and index state shares across machines, sessions, and CI. Tooling, scripts, and any agent editing `.gitignore` must NEVER add `.gm/`, `.gm/rs-learn.db`, `.gm/code-search/`, or legacy `.code-search/` to ignore rules. Per the gitignore parent-re-include caveat (re-including a path past an ignored parent dir is impossible), individual `.gm/*` entries (prd-state.json, lastskill, turn-state.json, trajectory-drafts/, ingest-drafts/, rslearn-counter.json) are listed one-by-one between `# >>> gm managed` markers, leaving `.gm/rs-learn.db` and `.gm/code-search/` un-ignored. Same rule for downstream repos: `lib/template-builder.js::generateGitignore()` must not emit any of those paths. Any project-local persistent state (chunk index, DB, embeddings) must write under `.gm/<name>/`, never to a top-level dotfile/dotdir.

**Adding a new platform**: update `PLATFORM_META` in `lib/page-generator.js` — single registration point, not obvious from adapter structure.

**Clean build required**: `cleanBuildDir()` must delete the entire output dir before regenerating. Skipping causes stale files to silently shadow new ones.

**Nothing fake in source the user runs**: stubs, mocks, placeholder returns, fixture-only paths, demo-mode short-circuits, and "TODO: implement" bodies are forbidden in shipped code. Scaffolds and shims are permitted only when they delegate to real behavior (real upstream API, real subprocess, real disk). Before adding a shim, check whether a published library or tool already provides that surface — maintaining a local reimplementation of an upstream solution drifts and ages. Detection is behavioral, not by keyword: code that always succeeds, returns the same value regardless of input, or short-circuits a real call to satisfy a type signature is a stub. Acceptance is real input through real code into real output, witnessed; anything less leaves the mutable open.

**Skills bundled in OC and Kilo**: gm-oc and gm-kilo bundle skills directly in the npm package. gc still uses external skills — its `loadSkillsFromSource()` returns `{}` intentionally.

**VS Code-family adapters: never ship `.vscodeignore` alongside `package.json::files`**. vsce hard-rejects with "Both a .vscodeignore file and a 'files' property in package.json were found. VSCE does not support combining both strategies." Adapters in `platforms/{antigravity,vscode,cursor}.js` must pick one — gm uses the `files` array, so `createFileStructure` must not emit `.vscodeignore`. Package with `npx @vscode/vsce package --allow-star-activation --skip-license --no-dependencies`.

**memorize sub-agent manages CLAUDE.md / AGENTS.md**: Do not inline-edit. Invocation: `Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')`. Classifier rejects changelog-shaped facts from AGENTS.md ingestion (rs-learn store still accepts them).

**Autonomy**: Once a PRD is written, agents EXECUTE through to COMPLETE without asking. Asking permitted only as last resort for destructive-irreversible decisions or genuinely ambiguous user intent — prefer `exec:pause` over in-conversation asking. **The user's first request IS the authorization** — re-asking "want me to do X?" or "shape A vs B?" after the user said "do X" is forced closure dressed as deference. When two viable approaches exist, pick the read matching the obvious meaning, declare the choice in one line so the user can interrupt mid-chain, and execute. Multi-repo scope, build cost, CI duration, and binary-size impact are NEVER grounds to re-confirm. "Which of two viable approaches" is not ambiguous intent.

**Maximal Cover (covering-family obligation)**: When scope exceeds reach, enumerate all witnessable subsets and execute every member. Write the family into `.gm/prd.yml` as separate items with explicit dependency graph for parallelization. Residuals the agent judges within the spirit of the original ask AND completable from this session are self-authorized — expand the PRD with them and execute, do not stop to re-ask the user. Only residuals genuinely outside the original ask OR genuinely unreachable from this session are name-and-stop. When expanding under self-authorization, the agent declares its judgment in-response ("treating X as in-scope because Y") so the user can correct mid-chain. Silent expansion without the declaration is the failure mode this rule guards against. Detection: committed work + named out-of-spirit residuals must equal the witnessable closure; gap means cover is not yet maximal, re-enter PLAN.

**Sync-before-emit (codeinsight + search)**: rs-codeinsight and rs-search outputs must come from a freshly-completed index. No cache may serve a result without a digest match against the live filesystem (mtime sum + git HEAD + dirty-tree marker). Default invocation always runs fresh. `--read-cache` permitted only when `.codeinsight.digest` matches exactly; on mismatch the cache auto-refreshes before emitting. rs-search runs scan + embed + sweep before printing the first result and emits an `[index fully synced: …]` line so freshness is visible. Emitting from an unverified or partial index is forced closure equivalent to bluffing strength — the agent reads stale output as ground truth and acts on a state that no longer exists.

**Auto-recall on prompt-submit**: rs-plugkit prompt-submit hook derives a 2-6 word recall query from the user prompt, calls rs-learn `Searcher` directly via the shared tokio Runtime, and injects "## Recall for this prompt" into the systemMessage. Auto-search (codeinsight) runs at session-start; auto-recall runs at every prompt. Together they ensure every turn begins with prior memory loaded.

**ORIENT before naming any unknown**: planning skill prescribes a parallel pack of 3-5 `exec:recall` + 3-5 `exec:codesearch` calls before the first mutable is named. Hits become weak_prior; misses confirm the unknown is fresh. Cost equals skip cost — orient is free relative to the duplicated discovery and disagree-with-prior-witness risk it prevents.

**PRD MANDATORY**: writing `.gm/prd.yml` is non-negotiable for every task whose scope exceeds a literal single-file single-line edit. Skipping the PRD costs the same as writing it (the agent enumerates the work mentally either way) and loses durable trace, resumability, and the cover-maximality check.

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
  → publish.yml 12-platform matrix:
      - node cli.js gm-starter ./build (regenerates configs, NOT binaries)
      - copies plugkit.version + plugkit.sha256 into build/gm-<platform>/bin/
      - git init fresh empty dir + rsync + git add -A + git add -f bin/
      - diff --depth 1 clone of downstream to detect no-op
      - git push --force origin main → 1-commit orphan history (~<1MB)
  → /plugin detects new gm-cc HEAD → bootstrap.js downloads new binary
```

Downstream repos (gm-cc, gm-gc, gm-oc, gm-kilo, gm-codex, gm-qwen, gm-copilot-cli, gm-hermes, gm-vscode, gm-cursor, gm-zed, gm-jetbrains) reset to a single orphan commit on every publish.

**Repos involved (push to any triggers cascade):**
- `AnEntrypoint/rs-exec` — exec runner, browser sessions, idle cleanup
- `AnEntrypoint/rs-codeinsight` — code search backend
- `AnEntrypoint/rs-search` — file search backend
- `AnEntrypoint/rs-plugkit` — binary entry point, hook dispatcher; version source of truth in `Cargo.toml`
- `AnEntrypoint/gm` — `gm-starter/gm.json` holds `plugkitVersion`; CI publishes to gm-cc
- `AnEntrypoint/gm-cc` — Claude Code plugin package; HEAD hash is what `/plugin` tracks

**To update anything**: push to the relevant repo. No manual version bumps, no local cargo builds. Never run `cargo update` or `cargo build` locally — push and let CI build.

**PUBLISHER_TOKEN required** in `rs-exec`, `rs-codeinsight`, `rs-search` for cascade.yml to trigger rs-plugkit. Set with: `gh secret set PUBLISHER_TOKEN --repo AnEntrypoint/<repo>`.

**Timeout enforcement**: `timeoutMs` is mandatory in the `execute` RPC — rs-exec hard-rejects missing or zero values with `anyhow!("timeoutMs required (positive integer milliseconds)")`. rs-plugkit CLI layer (Cmd::Exec, Cmd::Bash) accepts `--timeout-ms <u64>` with a DEFAULT_EXEC_TIMEOUT_MS=300_000 silent default (deprecation warning removed 2026-05-02 after serving its transitional purpose). On timeout, rs-exec returns `"timedOut": true` alongside partial output (preserved in both success and failed branches). plugkit prints `[exec timed out after Nms; partial output above]` to stderr and returns exit code 124 when no child exit code was captured. Do not pass --timeout-ms explicitly inside exec:bash bodies calling plugkit exec—the wrapper already injects this flag, and clap rejects duplicates. Downstream code (hook, agent-side callers) must pass explicit per-call-site budgets to rs-exec's execute RPC.

## rtk Auto-Wrapping in exec:bash

rs-exec injects an rtk shell-function preamble into every bash script so common dev commands (git/cargo/pytest/jest/npm/yarn/pnpm/tsc/eslint/docker/kubectl/ruff/mypy/ls/find/diff/rg) transparently route through the rtk CLI proxy for token compression. Gated on `which("rtk")` + `RTK_DISABLE` unset + `RTK_ACTIVE` unset (recursion guard). Per-call escape: `RTK_BYPASS=1 <cmd>`. Wrapped-command list is a const array in `rs-exec/src/runtime.rs` near `rtk_preamble()` — adding a command is one line, push to rs-exec, cascade rebuilds everything. rtk binary is built from source in `rs-plugkit/.github/workflows/release.yml` via `cargo install --git rtk-ai/rtk` (rtk has no Rust library surface; no upstream prebuilt path) across all 6 targets including win-arm64 which upstream rtk-ai releases skip. Bootstrap fetches rtk best-effort alongside plugkit; absence never blocks plugkit usage.

## Hooks are all Rust (plugkit), no JS sidecars

Every hook event (session-start, pre/post-tool-use, prompt-submit, pre/post-compact, session-end, stop, stop-git) dispatches to a module under `rs-plugkit/src/hook/`. The `hooks/` directory in each generated platform contains only `hooks.json` (the manifest) — never `.js` files. Cross-hook coordination uses `.gm/turn-state.json` written by `prompt_submit` and read/incremented by pre/post-tool-use. Only execution-path JS that survives is `gm-starter/bin/bootstrap.js` (chicken-egg: it downloads plugkit). Adding a new hook event = new module under `src/hook/` + arm in `main.rs` Hook match + entry in `lib/hook-spec.js::CANONICAL_SUBCOMMANDS` + wiring in `platforms/cli-config-shared.js`. Do not reintroduce `{kind:'js'}` hook entries — the conhost pop-up bug on Windows came from Node `spawn(detached:true)` allocating a fresh console even with `windowsHide:true`.

## Observability is on by default

Every program in the gm stack writes structured JSONL to `~/.claude/gm-log/<YYYY-MM-DD>/<subsystem>.jsonl` (subsystems: exec, hook, plugkit, rs_learn, rs_codeinsight, rs_search, bootstrap, plugkit_wrapper). Inspect with `plugkit log {path|tail|grep|stats|prune|subsystems}` instead of re-running with print debugging. `tail` merges entries across all subsystems sorted by timestamp. `subsystems` lists today's .jsonl basenames. `stats --days N` aggregates totals across last N days (default behavior unchanged when --days omitted). `prune --days N` removes day-dirs older than N (default 14) — manual only. Logs are never auto-deleted; retention is the user's call. The user runs `plugkit log prune --days N` when they want to reclaim disk. Disable logging via `GM_LOG_DISABLE=1`; relocate via `GM_LOG_DIR`. Instrumentation lives at the dispatch boundary (one wrap per dispatcher covers all variants) — never per-handler scatter. Same discipline applies to code written for users: extend the project's existing observability surface, or seed one with a tiny JSONL appender to `.gm/log/` mirroring the plugkit shape. Emit on state transitions, error boundaries, external IO, nontrivial decisions; skip loop bodies and parser steps.

## Windows spawnSync .cmd/.bat EINVAL

Any Node.js `spawnSync`/`spawn` call targeting a `.cmd` or `.bat` file on Windows (vsce, antigravity, code, npx/bunx shims, any Windows-only CLI) MUST set `shell: true` and quote args containing spaces or special chars. Without `shell: true` it fails with `spawnSync <path>.cmd EINVAL` due to the CVE-2024-27980 mitigation in all current Node versions. Applies to every platform installer in `platforms/*.js` and any generated bin scripts.

## exec:nodejs Silent Errors

exec:nodejs code that hits fs.readFileSync ENOENT or other synchronous system errors appears to complete silently (no output, exit code 0) until rs-exec receives the bun 1.3.8 mitigation via cascade. Before cascade reaches downstream gm-cc, wrap filesystem operations in explicit try/catch blocks that call `console.error(e)` and `process.exit(1)` to surface errors.

## Site Build & Documentation

**Flatspace article extraction**: docs/*.html source files have their `<head>` stripped during article extraction. Per-page mermaid loaders, style imports, and custom styles are lost. Any visual styling or script loader that must survive extraction MUST live in `site/theme.mjs::renderHtml` head `<style>` block or bundled in the `clientScript` that runs after `applyDiff`, NOT in the per-page HTML `<head>`.

**Mermaid integration**: `theme.mjs` (articleClient + landingClient) dynamic-imports mermaid from cdn.jsdelivr.net after `applyDiff` and calls `mermaid.run()` on `.mermaid` blocks. `startOnLoad` must be false—the parse happens before article injection, so `startOnLoad` would miss injected blocks. Theme auto-detects color scheme via `prefers-color-scheme`.

**Navigation**: `site/content/globals/navigation.yaml` uses grouped entry format—each item is either `{label, href}` (single link) or `{label, group: [{label, href}, ...]}` (dropdown menu). Dropdowns render via `<details>/<summary>` in `theme.mjs::GmTopbar`; no JS required. In-page topbars in docs/paper*.html et al. render directly on file open and must be kept in sync with the same markup.

**Landing page renderer**: the deployed `/` route on https://anentrypoint.github.io/gm/ is rendered by `site/theme.mjs` from `site/content/pages/home.yaml` via flatspace. `site/index.html` + `site/main.js` build `docs/bundle.js` for non-flatspace standalone preview only. Landing edits go through `site/theme.mjs` (Hero) and `site/content/pages/home.yaml` (content), never `site/index.html`.

**docs/styles.css is generated**: regenerated from `site/input.css` by `site/package.json` build script (copies input.css → docs/styles.css after esbuild). Direct edits to docs/styles.css are wiped on next build — append to site/input.css instead.

## Made with gm Page

`docs/made-with.html` is a static showcase of notable AnEntrypoint projects. Update the PROJECTS array when a new notable project is added — projects with interesting descriptions, meaningful star counts, or technically unusual scope. Static data, no runtime API calls. Standalone HTML, not bundled.