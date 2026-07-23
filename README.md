# glootius maximus (gm)

> **more coushin' for the puhin'**

**glootius maximus** (gm) exists to raise one number: the signal-to-noise ratio (SNR) of a coding agent. every failure an agent commits, narrating an unverified guess, forgetting a decision, shipping a placeholder, stopping early, is noise injected into the channel between what you asked and what gets built. gm is a skill that convinces your coding agent it already is a deterministic state machine, PLAN -> EXECUTE -> EMIT -> VERIFY -> CONSOLIDATE -> COMPLETE, and then enforces that conviction with a wasm-backed orchestrator, witnessed execution, and a covering family of bounded subsets that refuses to let "follow-up" become a synonym for "I gave up." every rule in it is one more noise source removed.

that orientation is also why gm is built for token austerity: every token an agent spends should be signal toward the work, never narration, hedging, or busy-output. austerity is SNR enforced at the budget.

it is named after **glootius maximus**, the muscle that holds you in the chair while you finish the work. the name is the joke and the discipline at once: the agent that sits down through PLAN -> EXECUTE -> EMIT -> VERIFY -> CONSOLIDATE -> COMPLETE actually ships. the agent that stands up early ships a stub with a green check on it.

built over 14000+ hours of supervised modification, across ~200 commits of daily use, every one of those hours spent tuning the same target: more agentic signal, less noise. free, open source, maintained by one person.

disclaimer: this is extremely opinionated. it will block bash, redirect your tools, refuse to write test files, force you to push git before ending a session, and reject any execute call without an explicit timeout. if that sounds terrible, this is not for you. if that sounds like what you wish your agent did automatically, keep sitting down.

## install

A Claude Code Agent Skill is just a directory at `~/.claude/skills/<name>/SKILL.md` (personal, all projects) or `.claude/skills/<name>/SKILL.md` (one project). The directory name becomes the slash command. No marketplace, no `npx skills` library -- the installer copies the directory into place.

**The npm package is `gm-skill`, not `gm`.** `npx gm@latest` resolves to an unrelated, unmaintained GraphicsMagick wrapper (`gm` on npm, last published years ago) with no `install` command -- it fails with `could not determine executable to run`. Always spell out the full package name below.

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

PLAN -> EXECUTE -> EMIT -> VERIFY -> CONSOLIDATE -> COMPLETE. Every transition is a verb the agent dispatches by writing to `.gm/exec-spool/in/<verb>/<N>.txt`. The wasm orchestrator (rs-plugkit) services it and writes the response to `.gm/exec-spool/out/`. The agent reads, follows the imperative prose, dispatches the next verb. CONSOLIDATE owns git-push + CI/CD validation, split off the COMPLETE gate. The chain isn't complete until `transition to=COMPLETE` returns COMPLETE phase AND the commit is pushed to origin.

### tools

Every tool the agent uses is a dispatch verb. No direct shell, no direct file writes outside the spool. The wasm host owns the side effects.

- **`recall`**: vector + KV recall against `rs-learn`, scored by cosine x recency, namespace-aware
- **`codesearch`**: semantic vector search across the project
- **`memorize`**: write to the recall index (with the BGE query/passage prefix asymmetry)
- **`browser`**: headful-by-default Chrome session driven natively by `agentplug` (CDP direct, no JS wrapper) -- a process-wide session registry keeps the launched Chrome child + CDP port alive across dispatches instead of relaunching per-call, profile persisted at `.gm/browser-chrome-profile-<session_id>/`; `session new|list|close|reset <id>` manages sessions explicitly; `screenshot[=name]`/`dom=<selector>`/`timeout=<ms>` body prefixes stack with a plain eval body for capture and DOM-scoped queries
- **`git_status` / `branch_status` / `git_push`**: git verbs that gate on porcelain
- **`filter`**: in-wasm stdout-compaction (grep/ls/tree/json/diff)

### gates

Orchestration state is tracked via `.gm/` marker files, not hook events. The gate that admits Write/Edit/git pre-execution runs natively inside `plugkit.wasm` (rs-plugkit `gates.rs` + its `hook_pre_tool_use` / `hook_stop` exports), driven off the same markers:

- **session-start**: bootstraps plugkit, seeds `.gm/next-step.md`, sets the `needs-gm` marker
- **turn entry**: the `instruction` verb reminds the agent to dispatch first and attaches the per-prompt auto-recall pack
- **pre-tool-use**: blocks Write/Edit/git before the gm skill fires for the turn
- **stop**: blocks session end while `.gm/prd.yml` has open items, mutables are unresolved, residual-scan hasn't fired, or the worktree is dirty or unpushed
- **VERIFY -> CONSOLIDATE**: `residual-scan-fired`, `prd-all-closed`, `mutables-all-resolved`, `claim-audit-clean` (every AGENTS.md/recall claim naming a commit hash resolves against real git log), `submodules-clean` (every tracked submodule gitlink matches that submodule's own live HEAD)
- **CONSOLIDATE -> COMPLETE**: `prd-all-closed`, `mutables-all-resolved`, `worktree-clean`, `residual-scan-fired`, `ci-validated-fresh` (`.gm/exec-spool/.ci-validated` matches current HEAD sha), `browser-witness-coverage`, `submodules-clean`

The gate graph itself is data, not hardcoded Rust: a project's `.gm/instructions/fsm/graph.json` (written by the `fsm-vendor` verb) can add states, rewire edges, or swap which gates guard which transition, including a `policy` block that externalizes previously-hardcoded behavior (status vocabularies, witness-requirement toggles, CAS retry attempts) as project-overridable JSON.

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

Seven git submodules, source only, none compiled artifacts:

- **`rs-plugkit/`** -- the wasm guest: orchestrator, gates, spool dispatch (the gm "brain")
- **`agentplug/`** -- the native host that loads that wasm and drives `browser`/`task` natively via CDP, plus the shared-plugin loader
- **`agentplug-bert`**, **`agentplug-libsql`**, **`agentplug-treesitter`** -- the shared native plugins agentplug loads alongside the gm wasm (embeddings, vector storage, syntax parsing)
- **`rs-codeinsight`**, **`rs-search`** -- codebase-indexing and search backends the `codesearch` verb consumes

A plain `git clone` leaves all seven empty -- clone with submodules, or init them after the fact:

```
git clone --recurse-submodules https://github.com/AnEntrypoint/gm.git
# or, in an existing checkout:
git submodule update --init --recursive
```

Empty submodule directories after a normal `git clone` are expected, not a bug -- they only matter if you're changing one of these repos' own source rather than the skill/installer JS in this repo's own tree.

## license

MIT
