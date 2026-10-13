# gm

A gate decides when work is done, not the coding agent.

Most agent harnesses ask the model to follow a process. gm turns the process into a state machine. Most edges have checks backed by git and the filesystem. Some checks read a marker file that the agent writes itself: `ci-validated-fresh` compares a marker file against HEAD, so a hand-written marker that names HEAD satisfies it. Treat that check as a record of intent, not as proof that CI ran.

[Releases](https://github.com/AnEntrypoint/gm/releases) | [License](./LICENSE) (MIT) | [Discord](https://discord.com/invite/c9VV59MKNr) | [Site](https://anentrypoint.github.io/gm/)

Contents: [Why gm uses a gate](#why-gm-uses-a-gate), [Install](#install), [How it works](#how-it-works), [Configuration](#configuration-from-your-own-repo), [Memory](#memory), [Release pipeline](#release-pipeline), [Developing gm itself](#developing-gm-itself), [License](#license).

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh
```

## Why gm uses a gate

The COMPLETE transition is guarded by the gates on its edge in `gm-config/fsm/graph.json`: 26 gates in total, of which 24 block a move and 2 are advisory. The predicate registry is `rs-plugkit/crates/plugkit-core/src/orchestrator/predicate_registry.rs`. A predicate that a graph names but the registry lacks is refused as `fsm_unknown_predicate`, so the registry is the source of truth.

A refused transition names the gate and the condition that failed. The agent cannot route around a refusal. Most conditions check a fact the gate observes itself. Examples: `prd-all-closed`, `mutables-all-resolved`, `worktree-clean`, `residual-scan-fired`, `submodules-clean` (each tracked submodule link against that submodule's own HEAD commit) and `no-hedge-language-in-diff`.

Two advisory gates, `lean-contract-only-description` and `lean-verifier-independent`, report and never refuse a move.

gm's rules forbid mock or synthetic test files, and the `no-synthetic-test-files` gate blocks them from a diff. Two submodules hold test files: `gm-mcp/test/` has 16 test files and 2 helper modules, and seven Rust files in `agentplug/` carry tests. Verification means running the real code path and reading the real output.

## Install

Install the `/gm` skill on macOS or Linux:

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh
```

Install the `/gm` skill on Windows PowerShell:

```
irm https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 | iex
```

Both scripts resolve the latest tagged release under [AnEntrypoint/gm releases](https://github.com/AnEntrypoint/gm/releases). They download the `gm-skill-<version>.tar.gz` asset and check it against its published SHA-256 sidecar. They then install `skills/gm` into `~/.claude/skills/gm/`. Run from a checkout (or with `GM_SKILL_SOURCE_DIR` set), the install is a link: a directory junction on Windows and a symlink elsewhere. A source edit is then served on the next dispatch. With no local source, the install copies the release.

The Node.js installer installs the skill and registers the MCP server in every detected agent host:

```
npx github:AnEntrypoint/gm -g
```

Drop `-g` to install into the current project. `node bin/gm-install.js` takes `--mcp-only` (repair the MCP registration without reinstalling), `--skills-only`, `--check-skills` and `--force-link`.

Inside a project that uses gm, the same two scripts run again without the `install` argument, for example `curl -fsSL .../install.sh | sh -s -- spool`. In this mode, each script resolves, checks, and runs the `agentplug-runner` binary (the native spool host) from `AnEntrypoint/agentplug-bin` releases. This step replaces the old `bun x gm-plugkit@latest spool` command. gm no longer uses a separate JS (JavaScript, a source-file language this repository tracks) launcher.

The MCP server launches from the local bundle, `~/.gm-tools/gm-mcp-server.mjs`, and never from an `npx` GitHub spec. A spec re-resolves the package on every connect, which under load can exceed the host's connect timeout. To repair a registration:

```
node bin/gm-install.js -g --mcp-only
node bin/gm-install.js --mcp-only
```

Restart the agent host after a registration change.

The `bin/gm` entry point runs a verb from a plain shell, with no agent host and no MCP client, using the same dispatch that the `gm` MCP tool runs.

## How it works

### The walk

The walk is a graph of 146 nodes in `gm-config/fsm/graph.json`: 129 principles, 8 tensions, 7 gates and 2 terminal nodes, joined by 376 edges. No node has a fixed place in a sequence. The agent makes a move by dispatching a verb. It writes a request file to `.gm/exec-spool/in/<verb>/<N>.txt`, and the runner writes the reply to `.gm/exec-spool/out/`. The reply carries the next instruction, or the reason for a refusal.

The plan is one file per row, `.gm/prd/<id>.yml`. Each row closes only with recorded `witness_evidence`. Open questions are one file per mutable, `.gm/mutables/<id>.yml`, and close with `mutable-resolve`. The walk completes only when the `prd-all-closed` gate passes.

### Tools

Every tool the agent uses is a dispatch verb. The verbs are listed in `skills/gm/docs/verbs.md`. The ones most used:

- `instruction` returns the prose for the current node with the live state.
- `transition` requests a move to a target node.
- `codesearch` runs ranked search over the project. `grep` runs an exhaustive literal or regex scan, reporting each hit as `path:line`.
- `callers` and `impact` answer who calls a symbol and what a symbol depends on.
- `recall` and `memorize` search and store project memory.
- `exec_js` runs code. A leading `timeoutMs=<ms>` line sets its budget, with a default of 300000 ms and a ceiling of 900000 ms.
- `fsm-vendor` copies the graph and the prose into a project so that the project can override them.

### Gates on the git path

Git operations go through gm's git verbs (`git_status`, `git_finalize`, `git_push`, `git_show`, `ci-status` and the rest). The stop gates block a session from ending while plan rows are open, mutables are unresolved, the residual scan has not run, or the worktree is dirty or unpushed.

## Configuration from your own repo

`gm-config/gm.config.json` sets the default configuration repository and its sync settings. Its `sync.debounce_ms` is 15000, so the runner checks the configuration repository at most once every 15 seconds. A project can override the instruction prose, the gate text and the graph from a repository it controls. The `fsm-vendor` verb scaffolds the override files.

A malformed configuration, or an unreachable repository, makes gm fall back to its compiled default and log the reason. A failed sync does not stop a dispatch.

**A configuration repository has the same authority as the project's own code.** A gate hook is JavaScript that runs when gm checks a gate. A hook synced from a configuration repository runs with full authority, and gm applies no sandbox or confirmation step to it. Point a project's configuration only at a repository that you trust with that access. The same applies to `AnEntrypoint/gm-config`, which is the default.

## Memory

`.gm/memories/*.md` is the durable, per-project memory store. Git tracks it, so the memory travels with the project. `recall` ranks memories by meaning: each memory is stored with an embedding (a vector that places text by meaning), and the score blends similarity with recency. The ranking half-life is 30 days, so an unreinforced memory loses score over time. Embeddings are computed by a shared plugin on the machine.

An alternate memory backend, `vendor/tencentdb-agent-memory/`, can serve `recall` and `memorize`. It is enabled through the `memory.tencentdb_backend` block in `gm-config/gm.config.json`.

## Release pipeline

A push to `main` that changes `skills/**` starts `.github/workflows/skill-release.yml`. The workflow bumps the version in `gm.json` and `package.json`, packages the skills into `gm-skill-<version>.tar.gz`, adds a SHA-256 sidecar, and publishes both to a tagged GitHub Release. The release uses no npm registry.

The other workflows in `.github/workflows/` are `bump-pins.yml`, `discipline-tree.yml`, `doc-drift.yml`, `gh-pages.yml` (which builds `site/` and publishes it with `docs/` to GitHub Pages) and `house-clean.yml`.

The WASM guest, `plugkit-slim.wasm`, is built from `rs-plugkit` and published to the `AnEntrypoint/plugkit-bin` releases. Hosts fetch it at runtime. This repository ships the Rust source for it, not the compiled binary.

## Developing gm itself

The root `.gitmodules` file lists 11 submodules:

- `rs-plugkit/`: the WASM guest. It holds the orchestrator, the gates and the spool dispatch.
- `agentplug/`: the native host, `agentplug-runner`, which loads the WASM guest.
- `agentplug-bert/`, `agentplug-libsql/`, `agentplug-treesitter/`: shared native plugins for embeddings, storage and syntax parsing.
- `agentplug-crux/`: plugin source.
- `rs-codeinsight/`: a standalone tree-sitter code structure analyzer.
- `rs-search/`: the search backend that `codesearch` consumes.
- `gm-mcp/`: the MCP wrapper and its committed server bundle.
- `gm-config/`: the default configuration repository. It holds the prose, the graph, the gate hooks and the policy data.
- `vendor/tencentdb-agent-memory/`: the vendored alternate memory backend.

Clone with the submodules:

```
git clone --recurse-submodules https://github.com/AnEntrypoint/gm.git
```

For an existing checkout:

```
git submodule update --init --recursive
```

An empty submodule directory is normal. It matters only when you change one of the dependency repositories themselves.

## License

MIT

## Donations

BTC: `15FLMay4of9rk4jK2davzzL4HDdGQtscGX`
