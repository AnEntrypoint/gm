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
|-- bin/               <- bootstrap + plugkit launcher (gmsniff / ccsniff are separate npm packages, `bun x gmsniff`, `bun x ccsniff`)
|-- lib/               <- runtime: spool dispatch, skill bootstrap, daemon mgmt
|-- agents/            <- subagent prompts (gm, memorize, research-worker, textprocessing)
|-- lang/              <- language packs (browser, ssh)
|-- gm-plugkit/        <- separate npm package that ships the wasm-wrapper
|-- gm.json            <- version + plugkit pin
|-- package.json       <- npm publish manifest
|-- AGENTS.md          <- architectural rules (present-tense, no history)
|-- CHANGELOG.md       <- release history
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
- **`browser`**: managed Chrome session with project-scoped profile at `.gm/browser-profile/`
- **`git_status` / `branch_status` / `git_push`**: git verbs that gate on porcelain
- **`filter`**: in-wasm stdout-compaction (grep/ls/tree/json/diff)

### hooks

- **session-start**: bootstraps plugkit, seeds `.gm/next-step.md`, sets `needs-gm` marker
- **prompt-submit**: reminds the agent to dispatch instruction first; injects per-prompt auto-recall
- **pre-tool-use**: blocks tool use before the gm skill fires for the turn
- **stop**: blocks session end while `.gm/prd.yml` has open items, mutables are unresolved, residual-scan hasn't fired, or the worktree is dirty

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

The plugkit wasm itself is built and released by [rs-plugkit](https://github.com/AnEntrypoint/rs-plugkit) on every push, published to npm as `plugkit-wasm` and to GitHub Releases as `plugkit-bin`. Bootstrapping the agent downloads the wasm at install time, it does not ship in this repo.

## license

MIT
