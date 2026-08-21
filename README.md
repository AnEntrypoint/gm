# glootius maximus (gm)

**Your coding agent doesn't decide when it's done. A gate does.**

```
$ transition to=COMPLETE

  DENIED  DECIDE -> COMPLETE   2 residuals

  x worktree-clean       3 uncommitted files
  x ci-validated-fresh   .ci-validated sha 7c90878 != HEAD e8ea29f

  next: git_finalize
```

Most agent harnesses ask the model to follow a process. gm turns the process into a state machine with real, git/filesystem-backed checks on most edges -- and is honest that a few of those checks (CI-freshness, browser-witness, claim-audit) verify a marker file the agent itself writes, not an independently-observed fact, so they still rely on the agent reporting honestly rather than being unfakeable.

[![release](https://img.shields.io/github/v/release/AnEntrypoint/gm.svg)](https://github.com/AnEntrypoint/gm/releases) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![Discord](https://img.shields.io/badge/discord-join-5865F2.svg)](https://discord.com/invite/c9VV59MKNr) [![site](https://img.shields.io/badge/site-anentrypoint.github.io%2Fgm-informational.svg)](https://anentrypoint.github.io/gm/)

**[Why gm hits different](#why-gm-hits-different)** &middot; **[A skill on a plugin host](#gm-is-a-skill-on-a-general-purpose-plugin-host-not-a-monolith)** &middot; **[Install](#install)** &middot; **[How it works](#how-it-works)** &middot; **[Release pipeline](#release-pipeline)** &middot; **[Developing gm itself](#developing-gm-itself)** &middot; **[Full paper (site)](https://anentrypoint.github.io/gm/paper/)** &middot; **[Discord](https://discord.com/invite/c9VV59MKNr)** &middot; **[License](#license)**

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh
```

## Why gm hits different

**The COMPLETE gate is code, but not uniformly unfakeable.** Ten conditions guard the DECIDE -> COMPLETE transition, a `Vec<String>` on an edge in `fsm.rs`, evaluated in Rust -- a failed gate refuses the transition and the agent cannot narrate its way to done. Six of the ten check something the gate itself observes and cannot be talked past: `prd-all-closed`, `mutables-all-resolved`, `worktree-clean` (real `git status --porcelain`), `residual-scan-fired`, `submodules-clean` (every tracked submodule gitlink against that submodule's own live HEAD), `no-hedge-language-in-diff`. The other four -- `ci-validated-fresh`, `browser-witness-coverage`, `app-loads-witnessed`, `claim-audit-clean` -- verify a marker file (`.gm/exec-spool/.ci-validated`, browser-witness records, etc.) that the agent's own dispatches write; `ci-validated-fresh` only checks that marker's `head_sha` matches `git rev-parse HEAD`, it never independently queries CI itself, so an agent that hand-writes the marker satisfies the gate without CI ever having run. `app-loads-witnessed` and `claim-audit-clean` additionally hardcode to `true` outside a wasm build. These four are still real code paths -- harder to satisfy by accident than a bare instruction -- but they trust the agent to report honestly, the same trust model as an unenforced prompt, just with more ceremony.

**A refused transition tells the agent what to do next.** Gate denials carry the recovery verb: `worktree-clean` returns `git_finalize`, `ci-validated-fresh` returns `ci-status`. You get an instruction, not an error.

**Repeat the same failure and it stops you.** After the same denial fires repeatedly, the response stops restating the refusal and instructs the agent to record the stuck state and switch to a bounded-retry discipline. Loops end.

**Zero test files, and that is checkable.** Search this repo for `*.test.*`, `*.spec.*`, `__tests__`, or a jest config. There are none, and there never will be. Verification means running the real path and reading the real output in the same turn. DECIDE also greps the diff for `Mock*`/`Fake*`/`Stub*` -- a mock shipped as a real integration is the same violation as a test file.

**You can loosen the rules, and it will tell on you.** The phase graph is JSON at `.gm/instructions/fsm/graph.json`. Rewire edges, add states, swap gates. gm compares your graph against the compiled default and reports every edge you made weaker.

This is extremely opinionated. It narrows bash to a handful of prefixes, routes git through verbs, refuses to write test files, forces a push before a session ends, and rejects any execute call without an explicit timeout. If that sounds terrible, this is not for you. If that sounds like what you wish your agent did automatically, keep sitting down.

14000+ hours of supervised modification, 8800+ commits, one person. Free, open source. Named after **glootius maximus**, the muscle that holds you in the chair while you finish the work.

## gm is a skill on a general-purpose plugin host, not a monolith

`agentplug`/`agentplug-runner` is a generic shared-plugin wasm runtime -- it hosts any wasm plugin that satisfies its imports; `gm` (via `rs-plugkit`) is one plugin loaded into it, not the runtime itself. The FSM graph a project runs is data (`.gm/instructions/fsm/graph.json`), swappable per-project via the `fsm-vendor` verb (see "configuring gm from your own repo" below) without forking anything. The gm skill ships with three optional native plugins the host can load alongside it (embeddings, vector storage, syntax parsing) -- none are required for gm's own state machine to run; they back specific verbs (`recall`'s embeddings, `codesearch`'s syntax-aware indexing). Prose, gate-denial text, and the FSM graph itself are all similarly swappable per-project or from a shared org-wide config repo -- see "configuring gm from your own repo" below.

## install

A Claude Code Agent Skill is just a directory at `~/.claude/skills/<name>/SKILL.md` (personal, all projects) or `.claude/skills/<name>/SKILL.md` (one project). The directory name becomes the slash command. No marketplace, no npm registry -- one script installs the skill, the same script also boots the native spool host inside any project that has it.

Install the `/gm` skill (POSIX):

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- install
```

Install the `/gm` skill (Windows PowerShell):

```
irm https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 | iex; Main install
```

Both resolve the latest tagged release under [AnEntrypoint/gm releases](https://github.com/AnEntrypoint/gm/releases), download the `gm-skill-<version>.tar.gz` asset, sha256-verify it against the sidecar published alongside it, and copy `skills/gm` into `~/.claude/skills/gm/`.

Inside a project using gm, the same scripts (without the `install` argument, e.g. `curl -fsSL .../install.sh | sh -s -- spool`) resolve, sha256-verify, and exec the `agentplug-runner` binary (the native spool host) from `AnEntrypoint/agentplug-bin` releases -- this is what `bun x gm-plugkit@latest spool` used to do; there is no separate JS launcher anymore.

The skill installs as `/gm`. On Claude Code, set these settings for the reasoning-in-code workflow gm expects (the installer scripts do not touch Claude Code settings; set them via `/config` or by editing `~/.claude/settings.json` directly):

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

This repo IS the published GitHub Release artifact. No build step, no factory. The directory layout you see at root is exactly what ships:

```
gm/
|-- skills/gm/        <- the skill (SKILL.md), installed as /gm
|-- bin/               <- plugkit wasm pins (gmsniff / ccsniff are separate npm packages, `bun x gmsniff`, `bun x ccsniff`)
|-- scripts/           <- publish-time helper scripts
|-- install.sh         <- POSIX installer: downloads the release tarball + agentplug-runner
|-- install.ps1        <- Windows installer, same logic
|-- gm-plugkit/        <- data files only (plugkit version/sha pins, vendored instruction prose) -- no JS, no package.json
|-- gm.json            <- version + plugkit pin
|-- package.json       <- metadata only, documents the release tarball's file list (not an npm publish manifest)
|-- AGENTS.md          <- architectural rules (present-tense, no history)
|-- CHANGELOG.md       <- release history
|-- docs/              <- long-form paper + crate/skill/distribution pages
`-- site/              <- flatspace site source (built to dist/ by CI)
```

Distribution: `publish.yml` tars the files `package.json`'s `files` array names into `gm-skill-<version>.tar.gz`, sha256-sidecars it, and uploads both to a tagged [GitHub Release](https://github.com/AnEntrypoint/gm/releases) on `AnEntrypoint/gm` -- no npm registry involved. `install.sh`/`install.ps1` download that release directly.

## how it works

### the state machine

SPECIFY -> PROVE -> EMIT -> STATE -> CONC -> SEC -> RES -> DECIDE -> COMPLETE, a non-linear graph with feedback edges from every later stage back to SPECIFY/EMIT/STATE/PROVE. Every transition is a verb the agent dispatches by writing to `.gm/exec-spool/in/<verb>/<N>.txt`. The wasm orchestrator (rs-plugkit) services it and writes the response to `.gm/exec-spool/out/`. The agent reads, follows the imperative prose, dispatches the next verb. DECIDE owns adversarial verification + git-push + CI/CD validation, gated by the full closure set into COMPLETE. The chain isn't complete until `transition to=COMPLETE` returns COMPLETE phase AND the push reaches origin.

### tools

Every tool the agent uses is a dispatch verb. No direct shell, no direct file writes outside the spool. The wasm host owns the side effects.

- **`recall`**: vector + KV recall against `.gm/memories/*.md` + the derived `gm.db` vector index, scored by cosine x recency, namespace-aware. In-tree in `rs-plugkit` -- the standalone `rs-learn` wasm crate this used to depend on is retired and no longer part of the pipeline.
- **`codesearch`**: semantic vector search across the project (`rs-codeinsight`/`rs-search` backends)
- **`memorize`**: write to the recall index (with the BGE query/passage prefix asymmetry)
- **`browser`**: fast, no-Chrome-process headless engine (oxibrowser, pure Rust) -- navigate/evaluate/dom-query/extract-markdown only, one implicit session, `session new/close/reset` are accepted no-ops
- **`cdp`**: the same plain-text-body grammar driving a real Chrome process over CDP (native, via `agentplug`, no JS wrapper) for anything `browser` can't do -- full CSS/layout fidelity, real screenshots, `capture`/`profile`/`trace`/`viewport=`. A process-wide session registry keeps the launched Chrome child + CDP port alive across dispatches, profile persisted at `.gm/browser-chrome-profile-<session_id>/`; `session new|list|close|reset <id>` manages sessions explicitly. `url=`/`dom=<selector>`/`screenshot[=name]`/`timeout=<ms>` compose in any order within one dispatch body; the script body itself is evaluated as a real async-function body -- a bare expression (`1+1`) gets auto-wrapped to return its value, matching REPL-style eval, not raw statement execution.
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
- **DECIDE -> COMPLETE**: `prd-all-closed`, `mutables-all-resolved`, `worktree-clean`, `residual-scan-fired`, `ci-validated-fresh` (`.gm/exec-spool/.ci-validated` matches current HEAD sha -- self-reported by the agent's own dispatch, not independently checked against CI), `browser-witness-coverage`, `app-loads-witnessed` (self-reported, hardcoded `true` outside a wasm build), `submodules-clean` (every tracked submodule gitlink matches that submodule's own live HEAD), `claim-audit-clean` (every AGENTS.md/recall claim naming a commit hash resolves against real git log; also hardcoded `true` outside wasm), `no-hedge-language-in-diff` -- ten gates total, see "Why gm hits different" above for which are self-reported vs independently observed

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

`.gm/memories/*.md` (human-readable, one memo per file) is the durable per-project memory store, committed to git so it travels with the project. `gm.db`, the derived vector index built from that corpus, is deliberately untracked -- it grew past GitHub's 50MB recommended limit under normal use, so it is treated as a rebuildable derived cache, not source, the same as any other derived store. Vector embeddings via BGE-small-en-v1.5 (with proper query/passage asymmetry: queries prefixed with `"Represent this sentence for searching relevant passages: "`, passages raw). LRU query-embedding cache (64 entries, 10-min TTL) sits in front to avoid re-embedding repeat queries. `recall` triggers a one-time full-corpus sync the first time a project's memory namespace has never been synced at all (a fresh clone, before `gm.db` exists) -- every read after that first touch stays on the cheap read-only path.

## release pipeline

A push to `main` triggers `.github/workflows/publish.yml`:

1. auto-bump `gm.json::version` + `package.json::version`
2. tar the release file set into `gm-skill-<version>.tar.gz`, sha256-sidecar it, upload both to a tagged GitHub Release on `AnEntrypoint/gm` (no build step, no npm registry)

`.github/workflows/gh-pages.yml` builds the `site/` flatspace source to `dist/` and deploys to GitHub Pages.

The plugkit wasm itself is built and released by [rs-plugkit](https://github.com/AnEntrypoint/rs-plugkit) (submoduled at `rs-plugkit/`, source only -- see below) on every push, published to npm as `plugkit-wasm` and to GitHub Releases as `plugkit-bin`. Bootstrapping the agent downloads the compiled wasm at install time; the compiled binary itself does not ship in this repo, only the Rust source that builds it.

## developing gm itself

Nine git submodules, source only, none compiled artifacts:

- **`rs-plugkit/`** -- the wasm guest: orchestrator, gates, spool dispatch (the gm "brain")
- **`agentplug/`** -- the native, plugin-agnostic host that loads wasm plugins (gm's included) and drives `browser`/`cdp` natively via CDP
- **`agentplug-bert`**, **`agentplug-libsql`**, **`agentplug-treesitter`** -- optional shared native plugins agentplug can load alongside the gm wasm (embeddings, vector storage, syntax parsing)
- **`rs-codeinsight`**, **`rs-search`** -- codebase-indexing and search backends the `codesearch` verb consumes
- **`gm-config/`** -- the default remote-config repo: prose, FSM graph, gate hooks, policy. Edited directly and pulled from at runtime. gm points at it out of the box unless a project or user configures its own.
- **`vendor/tencentdb-agent-memory/`** -- an optional alternate memory/skill-library backend `recall`/`memorize` can target instead of the default `.gm/memories/` + `gm.db` store (see `gm.config.json`'s `memory.tencentdb_backend`); vendored, not forked.

A plain `git clone` leaves all nine empty -- clone with submodules, or init them after the fact:

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
