# Architecture & Philosophy

gm generates 10 platform implementations from a single convention-driven source.

## Documentation Policy

Only record non-obvious technical caveats that cost multiple runs to discover. Remove anything that no longer applies. Never document what is already obvious from reading the code.

**No changelog history in AGENTS.md.** Every entry is a present-tense rule about what must or must-not be the case in code now. Forbidden: `(FIXED)` markers, commit hashes, dated audit entries, `## Learning audit` sections, "(added 2026-04-DD)" annotations, "we used to X, now we Y" phrasing. Historical framing belongs in `git log` and `CHANGELOG.md`.

**Detail-heavy caveats live in rs-learn (`.gm/rs-learn.db`), not here.** Per-crate runtime quirks, Windows process-spawn mechanics, hook implementation details, ocw/site/workflow specifics, and similar fact-base material are exfiltrated to rs-learn and reachable via `exec:recall`. AGENTS.md keeps only top-level rules that govern gm-the-repo. When in doubt: gm-the-repo architecture or cross-cutting policy stays here; single-crate or single-platform mechanism goes to rs-learn.

## Coding Style

**No comments in code.** No inline, block, or JSDoc comments anywhere — source, generated output, hooks, scripts.

**Skill SKILL.md files:** Strip explanatory prose. Keep ONLY invocation syntax, transition arrows, gate conditions, constraint lists, and code examples showing exact usage.

## Build

```
node cli.js gm-starter ./build
```

10 outputs in `build/gm-{cc,gc,oc,kilo,codex,copilot-cli,vscode,cursor,zed,jetbrains}`.

## Core Rules

**Shared memory & search index are tracked, never ignored**: `.gm/rs-learn.db` and `.gm/code-search/` are committed so memory and index state shares across machines, sessions, and CI. Tooling, scripts, and any agent editing `.gitignore` must NEVER add `.gm/`, `.gm/rs-learn.db`, `.gm/code-search/`, or legacy `.code-search/` to ignore rules. Per the gitignore parent-re-include caveat (re-including a path past an ignored parent dir is impossible), individual `.gm/*` entries (prd-state.json, lastskill, turn-state.json, trajectory-drafts/, ingest-drafts/, rslearn-counter.json) are listed one-by-one between `# >>> gm managed` markers, leaving `.gm/rs-learn.db` and `.gm/code-search/` un-ignored. Same rule for downstream repos: `lib/template-builder.js::generateGitignore()` must not emit any of those paths. Any project-local persistent state (chunk index, DB, embeddings) must write under `.gm/<name>/`, never to a top-level dotfile/dotdir.

**Adding a new platform**: update `PLATFORM_META` in `lib/page-generator.js` — single registration point, not obvious from adapter structure.

**Clean build required**: `cleanBuildDir()` must delete the entire output dir before regenerating. Skipping causes stale files to silently shadow new ones.

**Skills bundled in OC and Kilo**: gm-oc and gm-kilo bundle skills directly in the npm package. gc still uses external skills — its `loadSkillsFromSource()` returns `{}` intentionally.

**memorize sub-agent manages CLAUDE.md / AGENTS.md**: Do not inline-edit. Invocation: `Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')`. Classifier rejects changelog-shaped facts from AGENTS.md ingestion (rs-learn store still accepts them).

**Autonomy**: Once a PRD is written, agents EXECUTE through to COMPLETE without asking. Asking permitted only as last resort for destructive-irreversible decisions or genuinely ambiguous user intent — prefer `exec:pause` over in-conversation asking.

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

**Timeout enforcement**: `timeoutMs` is mandatory on every `execute` RPC and `--timeout <ms>` is mandatory on `rs-exec exec` and `rs-exec bash` CLI subcommands. Zero or missing causes hard error. The runner enforces via `tokio::time::timeout` wrapping `wait_for_completion`; on elapse it removes the task, calls `kill_tree(pid)`, and fails with `execution timed out after <N> ms`. CLI passes `timeout + 5000ms` as the RPC read deadline to prevent the client from timing out before the runner can respond. All downstream callers (rs-plugkit, rs-codeinsight, rs-search, hook code) must include `timeoutMs` in execute params. Default-fallback values are forbidden — pick a real budget per call site.

## Made with gm Page

`docs/made-with.html` is a static showcase of notable AnEntrypoint projects. Update the PROJECTS array when a new notable project is added — projects with interesting descriptions, meaningful star counts, or technically unusual scope. Static data, no runtime API calls. Standalone HTML, not bundled.
