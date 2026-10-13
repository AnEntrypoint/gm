# gm

gm is a skill and MCP server for coding agents (Claude Code, Cursor, Gemini CLI, Codex). It keeps a plan of rows, runs real checks, and refuses to let the agent mark a task finished until those checks pass. It is for developers who already use one of these agents.

A gate decides when work is done, not the coding agent. Most agent harnesses ask the model to follow a process. gm turns the process into a state machine. Most edges have checks backed by git and the filesystem. Some checks read a marker file that the agent writes itself: `ci-validated-fresh` compares a marker file against HEAD, so a hand-written marker that names HEAD satisfies it. Treat that check as a record of intent, not as proof that CI ran.

[Releases](https://github.com/AnEntrypoint/gm/releases) | [License](./LICENSE) (MIT) | [Discord](https://discord.com/invite/c9VV59MKNr) | [Site](https://anentrypoint.github.io/gm/)

Contents: [Install](#install), [Terms](#terms), [Why gm uses a gate](#why-gm-uses-a-gate), [How it works](#how-it-works), [Configuration](#configuration-from-your-own-repo), [Memory](#memory), [Developing gm itself](#developing-gm-itself), [Release pipeline](#release-pipeline), [Donations](#donations), [License](#license).

## Install

Run this in a terminal (Node.js required):

```
npx github:AnEntrypoint/gm -g
```

It installs the `/gm` skill and registers the MCP server in every detected agent host: Claude Code, Cursor, Gemini CLI and Codex. Drop `-g` to install into the current project only. `node bin/gm-install.js` takes `--mcp-only` (repair the MCP registration without reinstalling), `--skills-only`, `--check-skills` and `--force-link`. Restart the agent host after a registration change.

### Skill only

To install the skill without running the npx installer, on macOS or Linux:

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- install
```

On Windows PowerShell, `irm ... | iex` cannot pass an argument, so download the script and run it with `install`:

```
Invoke-WebRequest https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 -OutFile install.ps1
.\install.ps1 install
```

Both scripts resolve the latest tagged release under [AnEntrypoint/gm releases](https://github.com/AnEntrypoint/gm/releases). They download the `gm-skill-<version>.tar.gz` asset and check it against its published SHA-256 sidecar. They then install `skills/gm` into `~/.claude/skills/gm/`. Run from a checkout (or with `GM_SKILL_SOURCE_DIR` set), the install is a link: a directory junction on Windows and a symlink elsewhere. A source edit is then served on the next dispatch. With no local source, the install copies the release.

Inside a project, run the same script with the argument `spool`, for example `curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh -s -- spool`. It starts the `agentplug-runner` that serves the project's verbs: the script resolves, checks, and runs that native spool host from the `AnEntrypoint/agentplug-bin` releases.

The MCP server launches from the local bundle, `~/.gm-tools/gm-mcp-server.mjs`, and never from an npx GitHub spec. A spec re-resolves the package on every connect: measured at 8.2 s warm and 22.2 s cold, against 0.19 s to launch the bundle from disk, which under load can trip Claude Code's 30 s connect timeout ([gm-mcp/README.md](./gm-mcp/README.md)). To repair a registration:

```
node bin/gm-install.js -g --mcp-only
node bin/gm-install.js --mcp-only
```

Restart the agent host after a registration change.

The `bin/gm` entry point runs a verb from a plain shell, with no agent host and no MCP client, using the same dispatch that `gm.gm({verb, body})` inside the `gm_codemode` MCP tool runs.

## Terms

- **gate**: a check that must pass before the agent may move to its next step.
- **verb**: a command the agent sends to gm, such as `codesearch` or `git_status`.
- **plan row**: one task, stored as a file at `.gm/prd/<id>.yml`.
- **mutable**: one open question, stored as a file at `.gm/mutables/<id>.yml`.
- **walk**: one run of the gm state machine, driven to COMPLETE.

## Why gm uses a gate

gm will not let the agent say a task is done until every plan row is closed with recorded evidence, the CI marker names the current commit, and submodules are clean.

A refused transition names the gate and the condition that failed. The agent cannot route around a refusal. Most conditions check a fact the gate observes itself. Examples: `mutables-all-resolved`, `residual-scan-fired`, `submodules-clean` (each tracked submodule link against that submodule's own HEAD commit) and `no-hedge-language-in-diff`.

The `gates` array in `gm-config/fsm/graph.json` declares 26 gate predicates: 24 block a move and 2 are advisory. The edge into COMPLETE carries 21 of them, including `prd-all-closed`. The advisory gates, `lean-contract-only-description` and `lean-verifier-independent`, report and never refuse a move. The predicate registry is `rs-plugkit/crates/plugkit-core/src/orchestrator/predicate_registry.rs`. A predicate that a graph names but the registry lacks is refused as `fsm_unknown_predicate`, so the registry is the source of truth.

gm's rules forbid mock or synthetic test files, and the `no-synthetic-test-files` gate blocks them from a diff. That gate covers the diff under work; the submodules keep their own tests: `gm-mcp/test/` has 18 test files and 2 helper modules, and seven Rust files in `agentplug/` carry tests. Verification means running the real code path and reading the real output.

## How it works

You describe a change, the agent works through plan rows, and each step runs a check. The state machine behind it is described in `gm-config/fsm/graph.json`.

### The walk

The agent makes a move by dispatching a verb. It writes a request file to `.gm/exec-spool/in/<verb>/<session_id>-<N>.txt`, and the runner writes the reply to `.gm/exec-spool/out/`. The reply carries the next instruction, or the reason for a refusal.

The plan is one file per row, `.gm/prd/<id>.yml`. Each row closes only with recorded `witness_evidence`. Open questions are one file per mutable, `.gm/mutables/<id>.yml`, and close with `mutable-resolve`. The walk completes only when the edge into COMPLETE passes all of its gates.

### The graph

The graph has 146 nodes in `gm-config/fsm/graph.json`: 129 principles, 8 tensions, 6 gate-kind states and 3 terminal nodes, joined by 376 edges. Gate predicates sit on edges, not nodes. No node has a fixed place in a sequence.

### Tools

Every tool the agent uses is a dispatch verb. The verbs are listed in `skills/gm/docs/verbs.md`. The ones most used:

- `instruction` returns the prose for the current node with the live state.
- `transition` requests a move to a target node.
- `codesearch` runs ranked search over the project. `grep` runs an exhaustive literal or regex scan, reporting each hit as `path:line`.
- `callers` lists who calls a symbol. `impact` walks upstream callers by default, or callees with `direction` set to `callees`, up to `max_depth`.
- `recall` and `memorize` search and store project memory.
- `exec_js` runs code. A leading `timeoutMs=<ms>` line sets its budget, with a default of 300000 ms and a ceiling of 900000 ms.
- `fsm-vendor` copies the graph and the prose into a project so that the project can override them.

### Gates on the git path

Git operations go through gm's git verbs (`git_status`, `git_finalize`, `git_push`, `git_show`, `ci-status` and the rest). The stop gates block a session from ending while plan rows are open, mutables are unresolved, the residual scan has not run, or the worktree is dirty (`worktree-clean`). None of the gates on the edge into COMPLETE checks for an unpushed commit.

## Configuration from your own repo

To change gm's prompts, gates or graph for one project, run `fsm-vendor` in that project. A project can override the instruction prose, the gate text and the graph from a repository it controls. The verb scaffolds the override files.

`gm-config/gm.config.json` sets the sync settings: `sync.debounce_ms` is 15000, so the runner checks the configuration repository at most once every 15 seconds, and `sync.shallow` is true. The default configuration repository is AnEntrypoint/gm-config, the `gm-config/` submodule listed in `.gitmodules`.

**A configuration repository has the same authority as the project's own code.** A gate hook is JavaScript that runs when gm checks a gate. A hook synced from a configuration repository runs with full authority, and gm applies no sandbox or confirmation step to it. Point a project's configuration only at a repository that you trust with that access. The same applies to `AnEntrypoint/gm-config`, which is the default.

A prose tier that cannot be used makes gm serve its compiled default and emit a `prose_tier_degraded` event. An unreachable configuration repository makes gm serve the compiled default and record the reason in `.gm/exec-spool/.config-repo-unreachable.json`.

## Memory

`.gm/memories/` is the durable, per-project memory store. Its recall memos are rebuilt from `gm.db`, which git ignores, and `.gitignore` excludes them as `.gm/memories/mem-*.md`, along with the temporary `.gm/memories/*.tmp-*` files. `recall` ranks memories by meaning: each memory is stored with an embedding (a vector that places text by meaning), and the score blends similarity with recency. The ranking half-life is 30 days, so an unreinforced memory loses score over time. Embeddings are computed by a shared plugin on the machine.

An alternate memory backend, `vendor/tencentdb-agent-memory/`, can serve `recall` and `memorize`. It is enabled through the `memory.tencentdb_backend` block in `gm-config/gm.config.json`.

## Developing gm itself

The root `.gitmodules` file lists 11 submodules:

- `rs-plugkit/`: the WASM guest. It holds the orchestrator, the gates and the spool dispatch.
- `agentplug/`: the native host, `agentplug-runner`, which loads the WASM guest.
- `agentplug-bert/`, `agentplug-libsql/`, `agentplug-treesitter/`: shared native plugins for embeddings, storage and syntax parsing.
- `agentplug-crux/`: the signal-concentration engine. It surfaces the statistically rarest shapes in large, low-signal-density corpora.
- `rs-codeinsight/`: a standalone tree-sitter code structure analyzer.
- `rs-search/`: the tokenizer and reciprocal rank fusion library that `codesearch` uses.
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

An empty submodule directory is normal. It matters only when you change one of the dependency repositories themselves. Contributors: see [CONTRIBUTING.md](./CONTRIBUTING.md) for bug reports and pull requests.

## Release pipeline

A push to `main` that changes `skills/**` starts `.github/workflows/skill-release.yml`. The workflow bumps the patch version in `package.json`, packages the skills into `gm-skill-<version>.tar.gz`, adds a SHA-256 sidecar, and publishes both to a tagged GitHub Release. The release uses no npm registry.

The other workflows in `.github/workflows/` are `bump-pins.yml`, `discipline-tree.yml`, `doc-drift.yml`, `gh-pages.yml` (builds the flatspace site, adds the `docs/api` JSON files and publishes the result to GitHub Pages), `house-clean.yml`, `npx-route.yml` (guards the npx install command) and `process-leak.yml`.

The WASM guest, `plugkit-slim.wasm`, is built from `rs-plugkit` and published to the `AnEntrypoint/plugkit-bin` releases. Hosts fetch it at runtime. This repository ships the Rust source for it, not the compiled binary.

## Donations

BTC: `15FLMay4of9rk4jK2davzzL4HDdGQtscGX`

## License

MIT
