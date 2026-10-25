# gm

gm is a skill and MCP server for coding agents (Claude Code, Cursor, Gemini CLI, Codex). It keeps a plan of tasks, runs real checks, and refuses to let the agent mark a task finished until those checks pass. It is for developers who already use one of these agents.

A gate decides when work is done, not the coding agent. Most agent harnesses ask the model to follow a process. gm turns the process into a state machine. Six edges in the graph carry gate predicates, and the edge from the gate state `G_SWEEP` into `COMPLETE` carries 21 of them. The CI check (`ci-validated-fresh`) reads the CI marker file `.gm/exec-spool/.ci-validated`, which `git_finalize` writes when its inline `ci-status` check reports success or no applicable workflow for HEAD. A hand-written marker that names HEAD also passes, so the check records intent and does not prove that CI ran.

[Releases](https://github.com/AnEntrypoint/gm/releases) | [License](./LICENSE) (MIT) | [Discord](https://discord.com/invite/c9VV59MKNr) | [Site](https://anentrypoint.github.io/gm/)

## Install

Two commands install gm. Node.js is needed for the server. The server installs the rest itself on its first start: the `/gm` skill files into `~/.claude/skills` and `~/.agents/skills`, the agentplug runner, and the gm guest, each from its release with a checksum check (see [gm-mcp/README.md](./gm-mcp/README.md), "Self-install on a fresh machine").

The first command fetches the MCP server bundle once, and the second registers it with the agent host. This is the only step a human or host has to take. On macOS or Linux:

```
mkdir -p ~/.gm-tools && curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js -o ~/.gm-tools/gm-mcp-server.mjs
claude mcp add gm -s user -- node ~/.gm-tools/gm-mcp-server.mjs
```

On Windows PowerShell:

```
New-Item -ItemType Directory -Force "$HOME\.gm-tools" | Out-Null; Invoke-WebRequest https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js -OutFile "$HOME\.gm-tools\gm-mcp-server.mjs"
claude mcp add gm -s user -- node "$HOME\.gm-tools\gm-mcp-server.mjs"
```

For another host (Cursor, Gemini CLI, Codex), register the same stdio command in its MCP configuration: `node` with the argument `~/.gm-tools/gm-mcp-server.mjs`.

**MCP launch.** The server launches from the local bundle, `~/.gm-tools/gm-mcp-server.mjs`, and never from an npx GitHub spec: a spec re-resolves the package on every connect (measured at 8.2 s warm and 22.2 s cold, against 0.19 s from disk), which under load can trip Claude Code's 30 s connect timeout ([gm-mcp/README.md](./gm-mcp/README.md)). To repair a registration, run `claude mcp remove gm -s user` and then the `claude mcp add` line again.

Restart the agent host after a registration change. Then open the agent and run `/gm` with a description of the change. The agent turns it into plan rows (one task each, see Terms) and works through them until every plan row is closed.

The `bin/gm` entry point runs a verb from a plain shell, with no agent host and no MCP client, using the same dispatch that `gm.gm({verb, body})` inside the `gm_codemode` MCP tool (see Tools below) runs.

## Terms

- **gate**: a check that must pass before the agent may move to its next step.
- **edge**: a move from one graph state to another. A gate can sit on an edge and refuse the move.
- **predicate**: the check a gate runs, named in the `gates` array of `gm-config/fsm/graph.json`.
- **verb**: a command the agent sends to gm, such as `codesearch` or `git_status`.
- **spool**: the file queue under `.gm/exec-spool/`. A request is a file in `.gm/exec-spool/in/`, and the runner writes the reply to `.gm/exec-spool/out/`.
- **plan row**: one task, stored as a file at `.gm/prd/<id>.yml`.
- **unknown**: one open question, stored as a file at `.gm/unknowns/<id>.yml`.
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

Each plan row closes only with recorded `witness_evidence`, a string that `prd-resolve` takes beside the row `id`, naming a file:line, codesearch hit or exec output specific to that row. Each unknown, one open question, closes with `unknown-resolve`.

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

Git operations go through gm's git verbs (`git_status`, `git_finalize`, `git_push`, `git_show` and the rest). The CI verbs are `ci-status` (a run's status) and `ci-log` (what that run printed: filtered by job, step and pattern, capped by line and character budgets, each line split into `{n, job, step, at, text}`); `gm.describe` names them `ci_status` and `ci_log`, because the dispatch accepts either spelling. The gates `prd-all-closed`, `mutables-all-resolved`, `residual-scan-fired` and `worktree-clean` refuse the move into COMPLETE while plan rows are open, unknowns are unresolved, the residual scan has not run, or the worktree is dirty.

## Configuration from your own repo

To change gm's prompts or gate text for one project, run `fsm-vendor` in that project. It writes the compiled default prose and gate text into `.gm/instructions/`. A vendored file wins over the configuration repository for the same key, so delete the local file to fall back to the repository.

`gm-config/gm.config.json` sets the sync settings: `sync.debounce_ms` is 15000, so the runner checks the configuration repository at most once every 15 seconds. The default configuration repository is AnEntrypoint/gm-config, the `gm-config/` submodule listed in `.gitmodules`.

**A configuration repository controls gm's behavior in the project, including its gate hooks, so point a project's configuration only at a repository you trust.**

gm reads served prose from three tiers, in order: the project vendored file in `.gm/instructions/`, then the cached configuration repository, then the compiled default. A tier that cannot be used makes gm serve the compiled default and emit a `prose_tier_degraded` event. An unreachable configuration repository makes gm serve the compiled default and record the reason in `.gm/exec-spool/.config-repo-unreachable.json`.

## Memory

`.gm/memories/<key>.md` is the durable, per-project memory store, with a lean cache index in `.gm/gm.db`. The generated `.gm/memories/mem-*.md` recall memos are rebuilt from `gm.db` and are not tracked by git. `search_with_recency` (`rs-plugkit/crates/plugkit-core/src/rssearch_vectors.rs`) ranks memories by meaning: each memory is stored with an embedding (a vector that places text by meaning), and the score blends similarity with recency. The recency half-life is 30 days. Embeddings are computed on the machine by the shared `agentplug-bert` plugin.

## Developing gm itself

The root `.gitmodules` file lists 10 submodules:

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

`gm-mcp/` ships no test tree. The `no-synthetic-test-files` gate is diff-scoped (`gm-config/fsm/predicates.md`): it refuses a test file or test directory the diff introduces, not one that already exists.

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

The other workflows in `.github/workflows/` are `bump-pins.yml`, `contracts.yml` (checks the verb and contract surfaces of `rs-plugkit`, `agentplug` and `gm-mcp`), `discipline-tree.yml`, `doc-drift.yml`, `gh-pages.yml` (builds the flatspace site, adds the `docs/api` JSON files and publishes the result to GitHub Pages), `house-clean.yml`, `link-check.yml` (weekly check that every external link in the README, docs, site and skills answers), `npx-route.yml` (guards the npx install command) and `process-leak.yml`.

The WASM guest, `plugkit-slim.wasm`, is built from `rs-plugkit` and published to the `AnEntrypoint/plugkit-bin` releases. The `agentplug-runner` native host fetches it at runtime. This repository ships the Rust source for it, not the compiled binary.

## Donations

BTC: `15FLMay4of9rk4jK2davzzL4HDdGQtscGX`

## License

MIT
