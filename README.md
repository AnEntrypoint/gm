# gm

gm is a skill and MCP server for coding agents (Claude Code, Cursor, Gemini CLI, Codex). It keeps a plan of tasks, runs real checks, and refuses to let the agent mark a task finished until those checks pass. It is for developers who already use one of these agents.

A gate decides when work is done, not the coding agent. Most agent harnesses ask the model to follow a process. gm turns the process into a state machine. Six edges in the graph carry gate predicates, and the edge from the gate state `G_SWEEP` into `COMPLETE` carries 21 of them. The CI check (`ci-validated-fresh`) reads the CI marker file `.gm/exec-spool/.ci-validated`, which `git_finalize` writes when its inline `ci-status` check reports success or no applicable workflow for HEAD. A hand-written marker that names HEAD also passes, so the check records intent and does not prove that CI ran.

[Releases](https://github.com/AnEntrypoint/gm/releases) | [License](./LICENSE) (MIT) | [Discord](https://discord.com/invite/c9VV59MKNr) | [Site](https://anentrypoint.github.io/gm/)

## Install

Run this in a terminal (Node.js required):

```
npx github:AnEntrypoint/gm -g
```

It installs the `/gm` skill and registers the MCP server in every detected agent host: Claude Code, Cursor, Gemini CLI and Codex. Drop `-g` to install into the current project only.

**MCP launch.** The MCP server launches from the local bundle, `~/.gm-tools/gm-mcp-server.mjs`, and never from an npx GitHub spec. A spec re-resolves the package on every connect: measured at 8.2 s warm and 22.2 s cold, against 0.19 s to launch the bundle from disk, which under load can trip Claude Code's 30 s connect timeout ([gm-mcp/README.md](./gm-mcp/README.md)). To repair a registration, run the first command for a global install (`-g`) or the second for the current project:

```
node bin/gm-install.js -g --mcp-only
node bin/gm-install.js --mcp-only
```

Restart the agent host after a registration change. Then open the agent and run `/gm` with a description of the change. The agent turns it into plan rows (one task each, see Terms) and works through them until every plan row is closed.

The `bin/gm` entry point runs a verb from a plain shell, with no agent host and no MCP client, using the same dispatch that `gm.gm({verb, body})` inside the `gm_codemode` MCP tool (see Tools below) runs.

### Skill only

Use this path only if you do not want the npx installer. On macOS or Linux:

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- install
```

On Windows PowerShell, `irm ... | iex` cannot pass an argument, so download the script and run it with `install`:

```
Invoke-WebRequest https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 -OutFile install.ps1
.\install.ps1 install
```

Both scripts resolve the latest tagged release under [AnEntrypoint/gm releases](https://github.com/AnEntrypoint/gm/releases). They download the `gm-skill-<version>.tar.gz` asset and check it against its published SHA-256 sidecar. They then install `skills/gm` into `~/.claude/skills/gm/`. Run from a checkout (or with `GM_SKILL_SOURCE_DIR` set), the install is a link: a directory junction on Windows and a symlink elsewhere. A source edit then reaches the installed skill without a reinstall. With no local source, the install copies the release.

Inside a project, run the same script with the argument `spool`, for example `curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- spool`. It starts the `agentplug-runner` that serves the project's verbs: the script resolves, checks, and runs that native spool host from the `AnEntrypoint/agentplug-bin` releases.

## Terms

- **gate**: a check that must pass before the agent may move to its next step.
- **edge**: a move from one graph state to another. A gate can sit on an edge and refuse the move.
- **predicate**: the check a gate runs, named in the `gates` array of `gm-config/fsm/graph.json`.
- **verb**: a command the agent sends to gm, such as `codesearch` or `git_status`.
- **spool**: the file queue under `.gm/exec-spool/`. A request is a file in `.gm/exec-spool/in/`, and the runner writes the reply to `.gm/exec-spool/out/`.
- **plan row**: one task, stored as a file at `.gm/prd/<id>.yml`.
- **mutable**: one open question, stored as a file at `.gm/mutables/<id>.yml`.
- **principle**: one discipline, usually from a book or author, that the agent applies to the code, such as Jobs To Be Done (Clayton Christensen).
- **CI marker**: the file `.gm/exec-spool/.ci-validated`, the marker that the `ci-validated-fresh` predicate reads.
- **walk**: one run of the gm state machine, driven to COMPLETE.

## Why gm uses a gate

gm will not let the agent say a task is done until every plan row is closed with recorded evidence, the CI marker names the current commit, and submodules are clean.

A refused transition names the gate and the condition that failed. The agent cannot route around a refusal. The graph's `gates` array names 26 gate predicates, each defined in `rs-plugkit/crates/plugkit-core/src/orchestrator/predicate_registry.rs`; 24 can block a move and 2 are advisory and only report. Examples: `submodules-clean` (no submodule has drifted from its recorded commit) and `no-hedge-language-in-diff`.

gm's rules forbid mock or synthetic test files, and the `no-synthetic-test-files` gate blocks them from a diff. Verification means running the real code path and reading the real output.

## How it works

You describe a change, the agent works through plan rows, and each step runs a check.

### The walk

The agent sends each move as a `transition` verb, and gm replies with the next instruction or the reason for a refusal.

Each plan row closes only with recorded `witness_evidence`, a string that `prd-resolve` takes beside the row `id`, naming a file:line, codesearch hit or exec output specific to that row. Each mutable, one open question, closes with `mutable-resolve`.

### The graph

The graph has 146 states, listed under `states` in `gm-config/fsm/graph.json`: 129 principles, 8 tensions (nodes whose `kind` is `tension`, such as `OUSTERHOUTC`), 6 gate states and 3 terminal states, joined by 376 edges. The walk starts at the `JTBD` principle node, the value of `policy.initial_phase` in `gm-config/fsm/graph.json`. Each move follows an edge, and the gates on that edge decide it.

The same `policy` block names `G_FIXPOINT` as `policy.terminal_phase`. That node has no edge into `COMPLETE`: its outgoing edges go to `LOWERBOUND` and to `G_SWEEP`. The edge from the gate state `G_SWEEP` into `COMPLETE` is the only edge that enters `COMPLETE`. This README reports both values as the file gives them.

### Tools

The MCP server exposes one tool, `gm_codemode`. Its short JavaScript body calls each verb as a function, such as `gm.codesearch(...)`, and `gm.list()` lists them all. The verbs are listed in `skills/gm/docs/verbs.md`. The ones most used:

- `instruction` returns the prose for the current state, with the live state filled in.
- `transition` requests a move to a target state.
- `codesearch` runs ranked search over the project. `grep` runs an exhaustive literal or regex scan, reporting each hit with its path and line.
- `callers` lists who calls a symbol. `impact` walks upstream callers by default, or callees with `direction` set to `callees`, up to `max_depth`.
- `exec_js` runs code. A leading `timeoutMs=<ms>` line sets its budget, with a default of 300000 ms and a ceiling of 900000 ms.

### Gates on the git path

Git operations go through gm's git verbs (`git_status`, `git_finalize`, `git_push`, `git_show` and the rest). The CI verbs are `ci-status` (a run's status) and `ci-log` (what that run printed: filtered by job, step and pattern, capped by line and character budgets, each line split into `{n, job, step, at, text}`); `gm.describe` names them `ci_status` and `ci_log`, because the dispatch accepts either spelling. The gates `prd-all-closed`, `mutables-all-resolved`, `residual-scan-fired` and `worktree-clean` refuse the move into COMPLETE while plan rows are open, mutables are unresolved, the residual scan has not run, or the worktree is dirty.

## Configuration from your own repo

To change gm's prompts or gate text for one project, run `fsm-vendor` in that project. It writes the compiled default prose and gate text into `.gm/instructions/`. A vendored file wins over the configuration repository for the same key, so delete the local file to fall back to the repository.

`gm-config/gm.config.json` sets the sync settings: `sync.debounce_ms` is 15000, so the runner checks the configuration repository at most once every 15 seconds. The default configuration repository is AnEntrypoint/gm-config, the `gm-config/` submodule listed in `.gitmodules`.

**A configuration repository controls gm's behavior in the project, including its gate hooks, so point a project's configuration only at a repository you trust.**

gm reads served prose from three tiers, in order: the project vendored file in `.gm/instructions/`, then the cached configuration repository, then the compiled default. A tier that cannot be used makes gm serve the compiled default and emit a `prose_tier_degraded` event. An unreachable configuration repository makes gm serve the compiled default and record the reason in `.gm/exec-spool/.config-repo-unreachable.json`.

## Memory

`.gm/memories/<key>.md` is the durable, per-project memory store, with a lean cache index in `.gm/gm.db`. The generated `.gm/memories/mem-*.md` recall memos are rebuilt from `gm.db` and are not tracked by git. `recall` ranks memories by meaning: each memory is stored with an embedding (a vector that places text by meaning), and the score blends similarity with recency. The recency half-life is 30 days. Embeddings are computed on the machine by the shared `agentplug-bert` plugin.

## Developing gm itself

The root `.gitmodules` file lists 11 submodules:

- `rs-plugkit/`: the WASM guest, compiled to WebAssembly. It holds the orchestrator, the gates and the spool dispatch.
- `agentplug/`: the native host, `agentplug-runner`, which loads the WASM guest.
- `agentplug-bert/`, `agentplug-libsql/`, `agentplug-treesitter/`: shared native plugins for embeddings, storage and syntax parsing.
- `agentplug-crux/`: the signal-concentration engine. It surfaces the statistically rarest shapes in large, low-signal-density corpora.
- `rs-codeinsight/`: a tree-sitter codebase analyzer.
- `rs-search/`: the reciprocal rank fusion and tokenization library that the `plugkit-core` crate of `rs-plugkit` consumes.
- `gm-mcp/`: the MCP wrapper and its committed server bundle.
- `gm-config/`: the default configuration repository. It holds the prose, the graph, the gate hooks and the policy data.

The gate predicate registry is `rs-plugkit/crates/plugkit-core/src/orchestrator/predicate_registry.rs`. A predicate that a graph names but the registry lacks is refused as `fsm_unknown_predicate`, so the registry is the source of truth. The advisory gates are `lean-contract-only-description` and `lean-verifier-independent`.

`node bin/gm-install.js` takes `--mcp-only` (repair the MCP registration without reinstalling), `--skills-only`, `--check-skills`, `--force-link`, and `-g` or `--global`.

`gm-mcp/test/` has 18 test files and 2 helper modules, and seven Rust files in `agentplug/` carry tests. The `no-synthetic-test-files` gate covers the diff under work, not the test files listed above.

Clone with the submodules:

```
git clone --recurse-submodules https://github.com/AnEntrypoint/gm.git
```

For an existing checkout:

```
git submodule update --init --recursive
```

An empty submodule directory is normal. It matters only when you change one of the dependency repositories themselves. Contributors: see [CONTRIBUTING.md](./CONTRIBUTING.md) for bug reports and pull requests.

## Release pipeline

A push to `main` that changes `skills/**` starts `.github/workflows/skill-release.yml`. The workflow bumps the patch version in `package.json`, packages the skills into `gm-skill-<version>.tar.gz`, adds a SHA-256 sidecar, and publishes both to a tagged GitHub Release. The release uses no npm registry.

The other workflows in `.github/workflows/` are `bump-pins.yml`, `discipline-tree.yml`, `doc-drift.yml`, `gh-pages.yml` (builds the flatspace site, adds the `docs/api` JSON files and publishes the result to GitHub Pages), `house-clean.yml`, `npx-route.yml` (guards the npx install command) and `process-leak.yml`.

The WASM guest, `plugkit-slim.wasm`, is built from `rs-plugkit` and published to the `AnEntrypoint/plugkit-bin` releases. The `agentplug-runner` native host fetches it at runtime. This repository ships the Rust source for it, not the compiled binary.

## Donations

BTC: `15FLMay4of9rk4jK2davzzL4HDdGQtscGX`

## License

MIT
