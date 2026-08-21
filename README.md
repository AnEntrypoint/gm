# glootius maximus (gm)

A gate decides when work is done, not the coding agent.

```
$ transition to=COMPLETE

  DENIED  DECIDE -> COMPLETE   2 residuals

  x worktree-clean       3 uncommitted files
  x ci-validated-fresh   .ci-validated sha 7c90878 != HEAD e8ea29f

  next: git_finalize
```

Most agent harnesses ask the model to follow a process. gm turns the process into a state machine. The state machine has real checks on most edges, backed by git and the filesystem. Some checks (CI freshness, browser witness, claim audit) check a marker file the agent itself writes. These checks do not check an independent fact. gm states this limit openly: these four checks still depend on the agent reporting honestly.

[Releases](https://github.com/AnEntrypoint/gm/releases) - [License](./LICENSE) (MIT) - [Discord](https://discord.com/invite/c9VV59MKNr) - [Site](https://anentrypoint.github.io/gm/)

Contents: [Why gm uses a gate](#why-gm-uses-a-gate), [A skill on a plugin host](#gm-is-a-skill-on-a-general-purpose-plugin-host-not-a-monolith), [Install](#install), [How it works](#how-it-works), [Release pipeline](#release-pipeline), [Developing gm itself](#developing-gm-itself), [Full paper (site)](https://anentrypoint.github.io/gm/paper/), [License](#license).

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh
```

## Why gm uses a gate

The COMPLETE gate is code. It is not equally strict on every condition. Ten conditions guard the transition from DECIDE to COMPLETE. Rust code holds these ten conditions as a `Vec<String>` on one edge in `fsm.rs`. A failed condition refuses the transition. The agent cannot talk its way past a refusal. Six of the ten conditions check a fact the gate itself observes. The agent cannot talk past these six: `prd-all-closed`, `mutables-all-resolved`, `worktree-clean` (a real `git status --porcelain` check), `residual-scan-fired`, `submodules-clean` (each tracked submodule link against that submodule's own live HEAD commit), `no-hedge-language-in-diff`. The other four conditions check a marker file the agent's own dispatch writes: `ci-validated-fresh`, `browser-witness-coverage`, `app-loads-witnessed`, `claim-audit-clean`. Examples of these marker files: `.gm/exec-spool/.ci-validated`, and a set of browser-witness records. The `ci-validated-fresh` condition only checks that the marker's `head_sha` field matches the output of `git rev-parse HEAD`. It never queries the CI (continuous integration) system on its own. An agent that writes the marker file by hand satisfies this condition, even when CI never ran. `app-loads-witnessed` and `claim-audit-clean` each hold a hardcoded value of `true` outside a WASM (WebAssembly, the binary format plugkit-core compiles to) build. These four conditions still run real code. Real code is harder to satisfy by accident than a bare instruction in a prompt. But these four conditions still trust the agent to report honestly. This is the same trust model as an unenforced prompt, with more steps around it.

A refused transition tells the agent its next step. Each gate denial names a recovery verb. `worktree-clean` names `git_finalize` as the next verb. `ci-validated-fresh` names `ci-status` as the next verb. The agent gets an instruction, not a bare error.

When the same failure repeats, gm stops the agent. After the same denial fires many times in a row, the response stops restating the refusal. Instead, the response tells the agent to record the stuck state and switch to a bounded-retry method. This method ends loops.

gm has zero test files, and a user can check this fact directly. Search this repository for `*.test.*`, `*.spec.*`, `__tests__`, or a jest config file. None exist, and gm's rules forbid adding any. In gm's method, verification means running the real code path and reading the real output, in the same session as the code change. The DECIDE phase also searches the diff for names starting with `Mock`, `Fake`, or `Stub`. A mock shipped as a real integration is the same rule violation as a test file.

A user can loosen gm's rules, and gm reports this change. The phase graph is a JSON (JavaScript Object Notation, a data format) file at `.gm/instructions/fsm/graph.json`. A user can rewire edges, add states, or swap which condition guards which edge in this file. gm compares the user's graph against its own compiled default graph. gm then reports every edge where the user's change made a condition weaker.

gm holds strong, narrow opinions. gm narrows the Bash tool to a small set of allowed command prefixes. gm routes every git operation through its own verbs. gm refuses to write test files. gm forces a push to the remote repository before a session ends. gm rejects any execute call that has no explicit time limit set on it.

The project has over 14000 hours of supervised use and over 8800 commits, built by one person. gm is free and open source. The name comes from the gluteus maximus, the muscle that holds a person in a chair through to the end of a task.

## gm is a skill on a general-purpose plugin host, not a monolith

`agentplug`/`agentplug-runner` is a general-purpose, shared-plugin WASM runtime. It hosts any WASM plugin that meets its import contract. `gm` (through `rs-plugkit`) is one plugin loaded into this runtime, not the runtime itself. The FSM (finite state machine, the phase graph gm advances through) graph a project runs is a data file at `.gm/instructions/fsm/graph.json`. A project can swap this file through the `fsm-vendor` verb (see "configuring gm from your own repo" below), with no fork of any repository needed. The gm skill ships with three optional native plugins. The host can load each plugin alongside gm: an embeddings plugin, a vector storage plugin, and a syntax parsing plugin. None of the three is a requirement for gm's own state machine to run. Each plugin backs a specific verb: the embeddings plugin backs the `recall` verb, and the syntax parsing plugin backs the `codesearch` verb. The instruction prose, the gate-denial text, and the FSM graph are each swappable per project, or from one shared configuration repository across an organization. See "configuring gm from your own repo" below.

## Install

A Claude Code Agent Skill is a directory at `~/.claude/skills/<name>/SKILL.md` for personal use across every project, or at `.claude/skills/<name>/SKILL.md` for one project. The directory name becomes the slash command. gm needs no marketplace and no npm registry. One script installs the skill. The same script also starts the native spool host inside any project that has gm installed.

Install the `/gm` skill on a POSIX system (Linux, macOS):

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- install
```

Install the `/gm` skill on Windows PowerShell:

```
irm https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 | iex; Main install
```

Both scripts resolve the latest tagged release under [AnEntrypoint/gm releases](https://github.com/AnEntrypoint/gm/releases). Each script downloads the `gm-skill-<version>.tar.gz` asset. Each script checks the download against a published sha256 sidecar file. Each script then copies `skills/gm` into `~/.claude/skills/gm/`.

Inside a project that uses gm, the same two scripts run again without the `install` argument, for example `curl -fsSL .../install.sh | sh -s -- spool`. In this mode, each script resolves, checks, and runs the `agentplug-runner` binary (the native spool host) from `AnEntrypoint/agentplug-bin` releases. This step replaces the old `bun x gm-plugkit@latest spool` command. gm no longer uses a separate JS (JavaScript, a source-file language this repository tracks) launcher.

The skill installs as `/gm`. On Claude Code, set the settings below for the reasoning-in-code method gm expects. The installer scripts do not change Claude Code settings on their own. Set these values through the `/config` command, or by editing `~/.claude/settings.json` directly.

- `autoCompactEnabled: true`
- `autoCompactWindow: 380000` (an absolute token count, 38 percent of a 1M-token window, not a percentage setting)
- `effortLevel: "low"`
- `alwaysThinkingEnabled: false`

The model still reasons under gm. gm replaces hidden thinking tokens with reasoning carried out in code. The agent forms a hypothesis, runs the hypothesis as code or as a browser probe, then reads the real result. Reasoning becomes a witnessed run, not an unchecked internal thought. A user can change any of these four settings back at any time, in `~/.claude/settings.json` or through `/config`.

Add this line to your agent's global memory or system prompt. The installer already writes this line into `~/.claude/CLAUDE.md`.

```
always use the gm skill for everything, always fan out subagents
```

## What's in this repo

This repository IS the published GitHub Release artifact. gm has no build step and no separate factory step. The directory layout at the repository root is the exact layout that ships:

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

Distribution: `publish.yml` bundles the files named in `package.json`'s `files` array into `gm-skill-<version>.tar.gz`. The workflow adds a sha256 sidecar file to the bundle. The workflow then uploads both files to a tagged [GitHub Release](https://github.com/AnEntrypoint/gm/releases) on `AnEntrypoint/gm`. This step uses no npm registry. `install.sh` and `install.ps1` download that release directly.

## How it works

### The state machine

The phase order is SPECIFY, PROVE, EMIT, STATE, CONC, SEC, RES, DECIDE, then COMPLETE. This order is a non-linear graph. The graph carries feedback edges from every later phase back to SPECIFY, EMIT, STATE, or PROVE. Each transition between phases is a verb the agent dispatches. The agent dispatches a verb by writing a file to `.gm/exec-spool/in/<verb>/<N>.txt`. The WASM orchestrator (rs-plugkit) reads this file and writes its response to `.gm/exec-spool/out/`. The agent reads the response, follows the instruction inside it, then dispatches the next verb. The DECIDE phase owns adversarial verification, the git push step, and CI/CD (continuous integration and continuous delivery) validation. The full set of conditions that lead into COMPLETE gates the DECIDE phase. The chain does not reach completion until a `transition to=COMPLETE` dispatch returns the COMPLETE phase, and the push reaches the origin remote.

### Tools

Every tool the agent uses is a dispatch verb. The agent has no direct shell access and makes no direct file writes outside the spool. The WASM host owns every side effect.

- **`recall`**: a vector-plus-KV (key-value, a storage namespace inside a discipline) search against `.gm/memories/*.md` and a derived `gm.db` vector index. The search scores each result by cosine similarity times recency, and is namespace-aware. This verb lives in-tree in `rs-plugkit`. This verb once depended on the `rs-learn` WASM crate. That crate no longer exists, and the pipeline no longer uses it.
- **`codesearch`**: a semantic vector search across the project, backed by the `rs-codeinsight` and `rs-search` crates.
- **`memorize`**: writes to the recall index, using the BGE model's query/passage prefix asymmetry.
- **`browser`**: a fast headless engine (oxibrowser, written in pure Rust) that starts no Chrome process. This verb supports navigate, evaluate, DOM (Document Object Model) query, and markdown extraction only. It holds one implicit session. gm accepts the `session new`, `session close`, and `session reset` commands here, but each command performs no action.
- **`cdp`** (Chrome DevTools Protocol, used to drive a live browser): the same plain-text-body grammar as `browser`. This verb drives a real Chrome process over CDP, natively through `agentplug`, with no JS wrapper. Use this verb for anything `browser` cannot do. Examples: full CSS (Cascading Style Sheets, a styling language) fidelity, full layout fidelity, real screenshots, and the `capture`, `profile`, `trace`, and `viewport=` commands. A process-wide session registry keeps the launched Chrome child process and its CDP port alive across dispatches. The registry stores each session's browser profile at `.gm/browser-chrome-profile-<session_id>/`. The `session new`, `session list`, `session close <id>`, and `session reset <id>` commands manage these sessions directly. The commands `url=`, `dom=<selector>`, `screenshot[=name]`, and `timeout=<ms>` combine in any order inside one dispatch body. The dispatch runs the script body itself as a real async function body. A bare expression such as `1+1` is auto-wrapped to return its own value, matching REPL (read-eval-print loop) behavior rather than plain statement execution.
- **`git_status`, `branch_status`, `git_push`**: git verbs that check a clean porcelain status before they run.
- **`filter`**: an in-WASM stdout compaction step, for grep, ls, tree, JSON, and diff output.

### Gates

Files under `.gm/` track orchestration state as markers. gm does not use hook events for this purpose. The condition that admits a Write, an Edit, or a git operation before execution runs natively inside `plugkit.wasm`. This logic lives in `rs-plugkit`'s `gates.rs` file, through its `hook_pre_tool_use` and `hook_stop` exports. Both exports read the same marker files.

- **session-start**: starts plugkit, seeds `.gm/next-step.md`, and sets the `needs-gm` marker.
- **turn entry**: the `instruction` verb reminds the agent to dispatch a verb first, and attaches the per-prompt auto-recall data.
- **pre-tool-use**: blocks a Write or an Edit or a git operation before the gm skill runs for that turn.
- **stop**: blocks the end of a session in four cases. Case one: `.gm/prd.yml` (PRD, list of planned and resolved work rows tracked in .gm/prd.yml) still has an open row. Case two: a mutable value is unresolved. Case three: the residual scan has not run. Case four: the worktree is dirty or unpushed.
- **PROVE to EMIT**: `mutables-all-resolved`.
- **EMIT to STATE**: `no-synthetic-test-files`, `no-graphical-symbols-in-diff`, `no-admit-deferral-markers`.
- **STATE to CONC**: `idempotent-dispatch-replay-safe`.
- **SEC to RES**: `no-secrets-in-diff`.
- **RES to DECIDE**: `no-unchecked-panics-in-diff`.
- **DECIDE to COMPLETE**: ten conditions guard this transition in total. The list: `prd-all-closed`, `mutables-all-resolved`, `worktree-clean`, `residual-scan-fired`, `ci-validated-fresh`, `browser-witness-coverage`, `app-loads-witnessed`, `submodules-clean`, `claim-audit-clean`, `no-hedge-language-in-diff`. `ci-validated-fresh` checks that `.gm/exec-spool/.ci-validated` matches the current HEAD sha. The agent's own dispatch writes this marker file. `ci-validated-fresh` never checks the CI system directly. The agent self-reports `app-loads-witnessed`. gm's own code hardcodes `app-loads-witnessed` to `true` outside a WASM build. `submodules-clean` checks that each tracked submodule link matches that submodule's own live HEAD commit. `claim-audit-clean` checks that every commit hash named in AGENTS.md or a recall entry resolves against a real git log entry. gm's own code also hardcodes `claim-audit-clean` to `true` outside WASM. See "Why gm uses a gate" above for which conditions the agent self-reports and which conditions gm checks independently.

The gate graph itself is a data file, not hardcoded Rust code. A project's own `.gm/instructions/fsm/graph.json` file, written by the `fsm-vendor` verb, can add states, rewire edges, or swap which condition guards which transition. This file can also carry a `policy` block. This block turns previously hardcoded behavior into project-overridable JSON: status wording, witness-requirement toggles, and CAS (compare-and-swap) retry attempt counts.

### Configuring gm from your own repo

Any project using gm can override its instruction prose, its gate-denial text, its residual-scan messages, and the FSM graph itself. A project sets this override from a git repository it controls, with no fork of `rs-plugkit` needed. Run the `fsm-vendor` verb to scaffold every file a project can override. The verb writes the phase prose, the gate text, an example gate hook, and an inert `.gm/instructions/source.json.example` file. Then rename this example file to `.gm/instructions/source.json`:

```json
{ "repo": "https://github.com/your-org/your-gm-config", "branch": "main", "path": "" }
```

The daemon clones this repository and checks it again after a debounce period, 15 minutes by default (set in `config_sync.rs`'s `DEFAULT_DEBOUNCE_MS` value). A push to a project's configuration repository reaches every project pointing at that repository within this debounce window. The update is not instant, but it does reach every project eventually. gm resolves each configuration key through the same three steps, in order every time. First, a project's own `.gm/instructions/<key>.md` file wins outright over every other source. Second, the project's synced copy from its configuration repository applies next. Third, a compiled Rust default applies last, served only as a fallback in an emergency. A malformed `source.json` file, or an unreachable repository, causes gm to fall back to this compiled default, and gm logs the reason why. This fallback never crashes a dispatch. A prior good checkout of the configuration repository keeps serving through a short outage. gm does not discard this checkout during the outage. A project needs no `source.json` file before this system works. gm ships pointed at `AnEntrypoint/gm-config` by default. Every fresh install already pulls configuration from this shared repository, unless a project's own `source.json` file names a different one.

**Warning: a configuration repository holds the same authority as a project's own local git history.** This authority includes code execution rights. A gate hook is arbitrary JS code that runs at the moment gm checks a gate condition. A gate hook synced from a configuration repository executes with full authority. This authority equals the authority of a gate hook stored as a file in a project's own repository. A person who can push to a configuration repository gets code execution rights on every machine that syncs it. A person who compromises that repository gets the same rights. gm applies no sandbox, no local review step, and no confirmation prompt to this trust. Point `source.json` only at a repository trusted with this level of access. This same trust model applies to `AnEntrypoint/gm-config`. This same trust model also applies to a repository an organization runs on its own.

### Ground truth

gm's design has no mocks, no fakes, and no test files or test suites on disk. gm's method uses real services and real responses only. Verification means manual troubleshooting through live `exec_js` or `browser` execution, witnessed in the same session as the code change it checks.

### Memory

`.gm/memories/*.md` is the durable, per-project memory store. Each file holds one human-readable memo. Git tracks this directory, so the memory store travels with the project. `gm.db` is the vector index derived from this memo corpus. Git does not track `gm.db`. Under normal use, this file grew past GitHub's 50MB recommended file-size limit. gm treats this file as a rebuildable derived cache, not as source, the same as any other derived store. gm builds vector embeddings using the BGE-small-en-v1.5 model. This model uses a real query/passage asymmetry. gm adds the prefix "Represent this sentence for searching relevant passages: " to each query. gm leaves each passage unprefixed. An LRU (least recently used) cache sits in front of this process. This cache holds 64 query embeddings for 10 minutes, to skip re-embedding a repeat query. The `recall` verb triggers one full-corpus sync the first time a project's memory namespace has never synced before. An example: right after a fresh clone, before `gm.db` exists. Every read after that first sync stays on a cheaper, read-only path.

## Release pipeline

A push to the `main` branch starts the `.github/workflows/publish.yml` workflow:

1. The workflow bumps the version value in `gm.json` and in `package.json`.
2. The workflow bundles the release file set into `gm-skill-<version>.tar.gz`, adds a sha256 sidecar file, and uploads both files to a tagged GitHub Release on `AnEntrypoint/gm`. This step has no build step and uses no npm registry.

`.github/workflows/gh-pages.yml` builds the `site/` flatspace source into the `dist/` directory, then deploys this output to GitHub Pages.

The [rs-plugkit](https://github.com/AnEntrypoint/rs-plugkit) repository builds and releases the plugkit WASM binary itself, on every push to that repository. This repository holds `rs-plugkit` as a submodule at `rs-plugkit/`, as source code only. `rs-plugkit` publishes its build to npm under the name `plugkit-wasm`, and to GitHub Releases under the name `plugkit-bin`. Starting the agent downloads this compiled WASM binary at install time. This repository never ships the compiled binary itself, only the Rust source code that builds it.

## Developing gm itself

This repository holds nine git submodules. Each submodule holds source code only, with no compiled artifact checked in.

- **`rs-plugkit/`**: the WASM guest. This submodule holds the orchestrator, the gates, and the spool dispatch logic (the gm "brain").
- **`agentplug/`**: the native, plugin-agnostic host. This submodule loads WASM plugins, gm included, and drives the `browser` and `cdp` verbs natively through CDP.
- **`agentplug-bert`, `agentplug-libsql`, `agentplug-treesitter`**: optional shared native plugins. `agentplug` can load each plugin alongside the gm WASM plugin, for embeddings, vector storage, and syntax parsing in turn.
- **`rs-codeinsight`, `rs-search`**: codebase-indexing and search backends. The `codesearch` verb consumes both.
- **`gm-config/`**: the default remote configuration repository. This submodule holds prose, the FSM graph, gate hooks, and policy data. A user edits this repository directly, and gm pulls from it at run time. gm points at this repository by default, unless a project or user sets its own configuration repository.
- **`vendor/tencentdb-agent-memory/`**: an optional alternate memory and skill-library backend. The `recall` and `memorize` verbs can target this backend instead of the default `.gm/memories/` and `gm.db` store (see the `memory.tencentdb_backend` field in `gm.config.json`). This submodule holds vendored code, not a fork.

A plain `git clone` command leaves all nine submodules empty. Clone with the submodules included, or set up the submodules after cloning:

```
git clone --recurse-submodules https://github.com/AnEntrypoint/gm.git
# or, in an existing checkout:
git submodule update --init --recursive
```

A plain `git clone` command leaves each submodule directory empty. This is normal, not a defect. Empty submodules matter only in one case: a developer changes one of these nine repositories' own source code. Empty submodules do not matter when a developer changes only the skill or the installer script in this repository's own tree.

## License

MIT

## Donations

BTC: `15FLMay4of9rk4jK2davzzL4HDdGQtscGX`
