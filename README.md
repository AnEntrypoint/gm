# glootius maximus (gm)

**Your coding agent doesn't decide when it's done. A gate does.**

```
$ transition to=COMPLETE

  DENIED  DECIDE -> COMPLETE   2 residuals

  x worktree-clean       3 uncommitted files
  x ci-validated-fresh   .ci-validated sha 7c90878 != HEAD e8ea29f

  next: git_finalize
```

Most agent harnesses ask the model to follow a process. gm makes the process a program the model cannot talk its way past.

[![npm](https://img.shields.io/npm/v/gm-skill.svg)](https://www.npmjs.com/package/gm-skill) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![Discord](https://img.shields.io/badge/discord-join-5865F2.svg)](https://discord.com/invite/c9VV59MKNr) [![site](https://img.shields.io/badge/site-anentrypoint.github.io%2Fgm-informational.svg)](https://anentrypoint.github.io/gm/)

**[Why gm hits different](#why-gm-hits-different)** &middot; **[Install](#install)** &middot; **[How it works](#how-it-works)** &middot; **[Release pipeline](#release-pipeline)** &middot; **[Developing gm itself](#developing-gm-itself)** &middot; **[Full paper (site)](https://anentrypoint.github.io/gm/paper/)** &middot; **[Discord](https://discord.com/invite/c9VV59MKNr)** &middot; **[License](#license)**

```
npx gm-skill install
```

## Why gm hits different

**The COMPLETE gate is code, not a prompt.** Nine conditions guard the last transition -- PRD closed, mutables resolved, worktree clean, residual scan fired, CI green against the current HEAD sha, browser witness coverage, submodules in sync, every claimed commit hash resolves against real git log, no hedge language in the diff. They are a `Vec<String>` on an edge in `fsm.rs`, evaluated in Rust. A failed gate refuses the transition. The agent cannot narrate its way to done.

**A refused transition tells the agent what to do next.** Gate denials carry the recovery verb: `worktree-clean` returns `git_finalize`, `ci-validated-fresh` returns `ci-status`. You get an instruction, not an error.

**Repeat the same failure and it stops you.** After the same denial fires repeatedly, the response stops restating the refusal and instructs the agent to record the stuck state and switch to a bounded-retry discipline. Loops end.

**Zero test files, and that is checkable.** Search this repo for `*.test.*`, `*.spec.*`, `__tests__`, or a jest config. There are none, and there never will be. Verification means running the real path and reading the real output in the same turn. DECIDE also greps the diff for `Mock*`/`Fake*`/`Stub*` -- a mock shipped as a real integration is the same violation as a test file.

**You can loosen the rules, and it will tell on you.** The phase graph is JSON at `.gm/instructions/fsm/graph.json`. Rewire edges, add states, swap gates. gm compares your graph against the compiled default and reports every edge you made weaker.

This is extremely opinionated. It narrows bash to a handful of prefixes, routes git through verbs, refuses to write test files, forces a push before a session ends, and rejects any execute call without an explicit timeout. If that sounds terrible, this is not for you. If that sounds like what you wish your agent did automatically, keep sitting down.

14000+ hours of supervised modification, 8800+ commits, one person. Free, open source. Named after **glootius maximus**, the muscle that holds you in the chair while you finish the work.

## install

A Claude Code Agent Skill is just a directory at `~/.claude/skills/<name>/SKILL.md` (personal, all projects) or `.claude/skills/<name>/SKILL.md` (one project). The directory name becomes the slash command. No marketplace, no `npx skills` library -- the installer copies the directory into place.

Interactive (offers Claude Code settings):

```
npx gm-skill install
```

Non-interactive (sets Claude Code settings outright, prints how to revert):

```
npx gm-skill install --yes
```

Project-local instead of home (`./.claude/skills/gm`):

```
npx gm-skill install --project
```

Spell out the full package name: the npm package is `gm-skill`, not `gm`. `npx gm@latest` resolves to an unrelated, unmaintained GraphicsMagick wrapper with no `install` command and fails with `could not determine executable to run`.

The skill installs as `/gm`. On Claude Code the installer also offers (interactive) or sets (`--yes`):

- `autoCompactEnabled: true`
- `autoCompactWindow: 380000` -- an absolute token count (38% of a 1M window), not a percentage
- `effortLevel: "low"`
- `alwaysThinkingEnabled: false`

The model still reasons -- gm replaces hidden thinking tokens with reasoning in code: form a hypothesis, run it as code or a browser probe, read the real result. Reasoning becomes a witnessed execution rather than an unverified internal monologue. Change any of these back in `~/.claude/settings.json` or via `/config` at any time.

then add this line to your agent's global memory / system prompt (the installer seeds it into `~/.claude/CLAUDE.md` for you):

```
always use the gm skill for everything, always fan out subagents
```

## what's in this repo

This repo IS the published `gm-skill` npm package. No build step, no factory. The directory layout you see at root is exactly what ships:

```
gm/
|-- skills/gm/        <- the skill (SKILL.md), installed as /gm
|-- bin/               <- bootstrap + installer + plugkit wasm pins (gmsniff / ccsniff are separate npm packages, `bun x gmsniff`, `bun x ccsniff`)
|-- scripts/           <- publish-time helper scripts
|-- gm-plugkit/        <- separate npm package: thin launcher + bootstrap that downloads and delegates to the native agentplug-runner (sole loader, no JS-wrapper fallback)
|-- gm.json            <- version + plugkit pin
|-- package.json       <- npm publish manifest
|-- AGENTS.md          <- architectural rules (present-tense, no history)
|-- CHANGELOG.md       <- release history
|-- docs/              <- long-form paper + crate/skill/distribution pages
`-- site/              <- flatspace site source (built to dist/ by CI)
```

The two npm packages this repo publishes:

- **`gm-skill`**: the npm package that bundles the `/gm` skill + installer (`npx gm-skill install`)
- **`gm-plugkit`**: the wasm-wrapper daemon, dependency of `gm-skill`

## how it works

### the state machine

SPECIFY -> PROVE -> EMIT -> STATE -> CONC -> SEC -> RES -> DECIDE -> COMPLETE, a non-linear graph with feedback edges from every later stage back to SPECIFY/EMIT/STATE/PROVE. Every transition is a verb the agent dispatches by writing to `.gm/exec-spool/in/<verb>/<N>.txt`. The wasm orchestrator (rs-plugkit) services it and writes the response to `.gm/exec-spool/out/`. The agent reads, follows the imperative prose, dispatches the next verb. DECIDE owns adversarial verification + git-push + CI/CD validation, gated by the full closure set into COMPLETE. The chain isn't complete until `transition to=COMPLETE` returns COMPLETE phase AND the push reaches origin.

### tools

Every tool the agent uses is a dispatch verb. No direct shell, no direct file writes outside the spool. The wasm host owns the side effects.

- **`recall`**: vector + KV recall against `rs-learn`, scored by cosine x recency, namespace-aware
- **`codesearch`**: semantic vector search across the project
- **`memorize`**: write to the recall index (with the BGE query/passage prefix asymmetry)
- **`browser`**: headful-by-default Chrome session driven natively by `agentplug` (CDP direct, no JS wrapper) -- a process-wide session registry keeps the launched Chrome child + CDP port alive across dispatches instead of relaunching per-call, profile persisted at `.gm/browser-chrome-profile-<session_id>/`; `session new|list|close|reset <id>` manages sessions explicitly; `screenshot[=name]`/`dom=<selector>`/`timeout=<ms>` body prefixes stack with a plain eval body for capture and DOM-scoped queries
- **`git_status` / `branch_status` / `git_push`**: git verbs that gate on porcelain
- **`filter`**: in-wasm stdout-compaction (grep/ls/tree/json/diff)

### gates

`.gm/` marker files track orchestration state, not hook events. The gate that admits Write/Edit/git pre-execution runs natively inside `plugkit.wasm` (rs-plugkit `gates.rs` + its `hook_pre_tool_use` / `hook_stop` exports), driven off the same markers:

- **session-start**: bootstraps plugkit, seeds `.gm/next-step.md`, sets the `needs-gm` marker
- **turn entry**: the `instruction` verb reminds the agent to dispatch first and attaches the per-prompt auto-recall pack
- **pre-tool-use**: blocks Write/Edit/git before the gm skill fires for the turn
- **stop**: blocks session end while `.gm/prd.yml` has open items, mutables are unresolved, residual-scan hasn't fired, or the worktree is dirty or unpushed
- **PROVE -> EMIT**: `mutables-all-resolved`
- **EMIT -> STATE**: `no-synthetic-test-files`, `no-graphical-symbols-in-diff`, `no-admit-deferral-markers`
- **STATE -> CONC**: `idempotent-dispatch-replay-safe`
- **SEC -> RES**: `no-secrets-in-diff`
- **RES -> DECIDE**: `no-unchecked-panics-in-diff`
- **DECIDE -> COMPLETE**: `prd-all-closed`, `mutables-all-resolved`, `worktree-clean`, `residual-scan-fired`, `ci-validated-fresh` (`.gm/exec-spool/.ci-validated` matches current HEAD sha), `browser-witness-coverage`, `submodules-clean` (every tracked submodule gitlink matches that submodule's own live HEAD), `claim-audit-clean` (every AGENTS.md/recall claim naming a commit hash resolves against real git log), `no-hedge-language-in-diff`

The gate graph itself is data, not hardcoded Rust: a project's `.gm/instructions/fsm/graph.json` (written by the `fsm-vendor` verb) can add states, rewire edges, or swap which gates guard which transition, including a `policy` block that externalizes previously-hardcoded behavior (status vocabularies, witness-requirement toggles, CAS retry attempts) as project-overridable JSON.

### configuring gm from your own repo

Any project using gm can override its instruction prose, gate-denial text, residual-scan messages, and the FSM graph itself from a git repo it controls, without forking rs-plugkit. Run the `fsm-vendor` verb to scaffold every overridable file (phase prose, gate text, an example gate hook, and an inert `.gm/instructions/source.json.example`), then rename that example to `.gm/instructions/source.json`:

```json
{ "repo": "https://github.com/your-org/your-gm-config", "branch": "main", "path": "" }
```

The daemon clones and re-checks that repo on a debounce, default 15 minutes (`config_sync.rs`'s `DEFAULT_DEBOUNCE_MS`). A push to your config repo reaches every project pointing at it within that window -- not instant, eventually consistent. Resolution order per key is always the same three steps. Your project's own `.gm/instructions/<key>.md` file wins outright. Your config repo's synced copy is next. A compiled Rust default is last, served only as an emergency fallback. A malformed `source.json` or unreachable repo degrades to that fallback and logs why. It never crashes a dispatch. A prior good checkout keeps serving through a transient outage rather than being discarded. No project needs to set up `source.json` before this works: gm ships pointed at `AnEntrypoint/gm-config` by default. Every fresh install already pulls from a shared config repo unless a project's own `source.json` says otherwise.

**WARNING: a config repo has the same authority as your own local git history, including code execution.** Gate hooks (arbitrary JS run at gate evaluation) execute from a synced config repo exactly as they would from a file in your own project. Anyone who can push to that repo, or compromise it, gets code execution on every machine syncing it -- there is no sandboxing, no local review step, no confirmation prompt. Only point `source.json` at a repo you trust with that level of access; the same trust model applies whether the repo is `AnEntrypoint/gm-config` or one your own org runs.

### ground truth

No mocks, no fakes, no test files or test suites on disk. Real services, real responses only -- verification is manual troubleshooting and debugging via live `exec_js`/`browser` execution, witnessed the same turn as the code it checks.

### memory

`.gm/rs-learn.db` is the per-project memory store, committed to git so it travels with the project. Vector embeddings via BGE-small-en-v1.5 (with proper query/passage asymmetry: queries prefixed with `"Represent this sentence for searching relevant passages: "`, passages raw). LRU query-embedding cache (64 entries, 10-min TTL) sits in front to avoid re-embedding repeat queries.

## release pipeline

A push to `main` triggers `.github/workflows/publish.yml`:

1. auto-bump `gm.json::version` + `package.json::version` + `gm-plugkit/package.json::version`
2. publish `gm-skill` to npm from repo root (no build step)
3. publish `gm-plugkit` to npm from `gm-plugkit/`
4. mirror `skills/gm/SKILL.md` to the `AnEntrypoint/gm-skill` repo (back-compat)

`.github/workflows/gh-pages.yml` builds the `site/` flatspace source to `dist/` and deploys to GitHub Pages.

The plugkit wasm itself is built and released by [rs-plugkit](https://github.com/AnEntrypoint/rs-plugkit) (submoduled at `rs-plugkit/`, source only -- see below) on every push, published to npm as `plugkit-wasm` and to GitHub Releases as `plugkit-bin`. Bootstrapping the agent downloads the compiled wasm at install time; the compiled binary itself does not ship in this repo, only the Rust source that builds it.

## developing gm itself

Eight git submodules, source only, none compiled artifacts:

- **`rs-plugkit/`** -- the wasm guest: orchestrator, gates, spool dispatch (the gm "brain")
- **`agentplug/`** -- the native host that loads that wasm and drives `browser`/`task` natively via CDP, plus the shared-plugin loader
- **`agentplug-bert`**, **`agentplug-libsql`**, **`agentplug-treesitter`** -- the shared native plugins agentplug loads alongside the gm wasm (embeddings, vector storage, syntax parsing)
- **`rs-codeinsight`**, **`rs-search`** -- codebase-indexing and search backends the `codesearch` verb consumes
- **`gm-config/`** -- the default remote-config repo: prose, FSM graph, gate hooks, policy. Edited directly and pulled from at runtime. gm points at it out of the box unless a project or user configures its own.

A plain `git clone` leaves all eight empty -- clone with submodules, or init them after the fact:

```
git clone --recurse-submodules https://github.com/AnEntrypoint/gm.git
# or, in an existing checkout:
git submodule update --init --recursive
```

A normal `git clone` leaves the submodule directories empty; this is not a bug. Empty submodules matter only if you change one of those repos' own source instead of the skill or installer JS in this repo's own tree.

## license

MIT

## donations

BTC: `15FLMay4of9rk4jK2davzzL4HDdGQtscGX`
