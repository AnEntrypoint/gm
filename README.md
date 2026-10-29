# gm

gm = skill + MCP server for coding agents (Claude Code, Cursor, Gemini CLI, Codex). Keeps plan of tasks, runs real checks, refuses let agent mark task done till checks pass. For devs already using one of these agents.

Gate decides when work done, not coding agent. Most harnesses ask model follow process. gm turns process into state machine. Six edges carry gate predicates; edge from gate state `G_SWEEP` into `COMPLETE` carries 21 of them. CI check (`ci-validated-fresh`) reads CI marker file `.gm/exec-spool/.ci-validated`, which `git_finalize` writes when inline `ci-status` check reports success or no applicable workflow for HEAD. Hand-written marker naming HEAD also passes, so check records intent, does not prove CI ran.

[Releases](https://github.com/AnEntrypoint/gm/releases) | [License](./LICENSE) (MIT) | [Discord](https://discord.com/invite/c9VV59MKNr) | [Site](https://anentrypoint.github.io/gm/)

## Install

One command. Needs Node.js (any current LTS, [nodejs.org](https://nodejs.org)); no npm, no npx, no clone. macOS or Linux:

```
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh | sh
```

Windows PowerShell:

```
irm https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.ps1 | iex
```

The installer installs the `/gm` skill, downloads the MCP server bundle to `~/.gm-tools/gm-mcp-server.mjs`, and registers it with Claude Code by absolute path. Restart Claude Code, then run `/gm`. On first start the server installs the agentplug runner and gm guest from their releases, each checked against its sha256 ([gm-mcp/README.md](./gm-mcp/README.md), "Self-install on a fresh machine").

Registration is one command, the same on every OS: `node ~/.gm-tools/gm-mcp-server.mjs register` (PowerShell: `node "$env:USERPROFILE\.gm-tools\gm-mcp-server.mjs" register`). The bundle resolves its own absolute path, so no shell expands `$HOME` or `~`. Rerun it to repair a broken `gm` entry; it is idempotent.

Any other MCP host (Cursor, Gemini CLI, Codex, others): the same stdio command in that host's MCP config: `node` with the absolute path of `gm-mcp-server.mjs`. From a checkout, `node bin/gm-install.js` installs the skill and registers the server with every detected host. The npx route is retired.

**MCP launch.** Server launches from local bundle, `~/.gm-tools/gm-mcp-server.mjs`, never from npx GitHub spec. Spec re-resolves package every connect (measured 8.2 s warm, 22.2 s cold, vs 0.19 s from disk), which under load can trip Claude Code's 30 s connect timeout ([gm-mcp/README.md](./gm-mcp/README.md)).

Restart agent host after registration change. Then open agent, run `/gm` with description of change. Agent turns it into plan rows (one task each, see Terms) and works through them until every plan row closed.

`bin/gm` entry point runs verb from plain shell, no agent host, no MCP client, same dispatch that `gm.gm({verb, body})` inside `gm_codemode` MCP tool (see Tools below) runs.

## Terms

- **gate**: check must pass before agent may move to next step.
- **edge**: move from one graph state to another. Gate can sit on edge and refuse move.
- **predicate**: check gate runs, named in `gates` array of `gm-config/fsm/graph.json`.
- **verb**: command agent sends to gm, such as `codesearch` or `git_status`.
- **spool**: file queue under `.gm/exec-spool/`. Request is file in `.gm/exec-spool/in/`; runner writes reply to `.gm/exec-spool/out/`.
- **plan row**: one task, stored as file at `.gm/prd/<id>.yml`.
- **unknown**: one open question, stored as file at `.gm/unknowns/<id>.yml`.
- **principle**: one discipline, usually from book or author, agent applies to code, such as Jobs To Be Done (Clayton Christensen).
- **CI marker**: file `.gm/exec-spool/.ci-validated`, marker `ci-validated-fresh` predicate reads.
- **walk**: one run of gm state machine, driven to COMPLETE.

## Why gm uses a gate

gm won't let agent say task done until every plan row closed with recorded evidence, CI marker names current commit, submodules clean.

Refused transition names gate and condition that failed. Agent cannot route around refusal. Graph's `gates` array names 26 gate predicates, each defined in `rs-plugkit/crates/plugkit-core/src/orchestrator/predicate_registry.rs`; 24 can block move, 2 advisory and only report. Examples: `submodules-clean` (no submodule drifted from recorded commit) and `no-hedge-language-in-diff`.

gm's rules forbid mock or synthetic test files; `no-synthetic-test-files` gate blocks them from diff. Verification means running real code path and reading real output.

## How it works

You describe change, agent works through plan rows, each step runs check.

### The walk

Agent sends each move as `transition` verb; gm replies with next instruction or reason for refusal.

Each plan row closes only with recorded `witness_evidence`, string `prd-resolve` takes beside row `id`, naming file:line, codesearch hit or exec output specific to that row. Each unknown closes with `unknown-resolve`.

### The graph

Graph has 146 states, listed under `states` in `gm-config/fsm/graph.json`: 129 principles, 8 tensions (nodes whose `kind` is `tension`, such as `OUSTERHOUTC`), 6 gate states, 3 terminal states, joined by 376 edges. Walk starts at `JTBD` principle node, value of `policy.initial_phase` in `gm-config/fsm/graph.json`. Each move follows edge; gates on that edge decide it.

Same `policy` block names `G_FIXPOINT` as `policy.terminal_phase`. That node has no edge into `COMPLETE`: outgoing edges go to `LOWERBOUND` and `G_SWEEP`. Edge from gate state `G_SWEEP` into `COMPLETE` is only edge entering `COMPLETE`. This README reports both values as file gives them.

### Tools

MCP server exposes one tool, `gm_codemode`. Short JavaScript body calls each verb as function, such as `gm.codesearch(...)`; `gm.list()` lists all. Verbs listed in `skills/gm/docs/verbs.md`. Most used:

- `instruction` returns prose for current state, live state filled in.
- `transition` requests move to target state.
- `codesearch` runs ranked search over project. `grep` runs exhaustive literal or regex scan, reporting each hit with path and line.
- `callers` lists who calls symbol. `impact` walks upstream callers by default, or callees with `direction` set to `callees`, up to `max_depth`.
- `exec_js` runs code. Leading `timeoutMs=<ms>` line sets budget; default 300000 ms, ceiling 900000 ms.

### Gates on the git path

Git ops go through gm's git verbs (`git_status`, `git_finalize`, `git_push`, `git_show` and rest). CI verbs: `ci-status` (run's status) and `ci-log` (what run printed: filtered by job, step, pattern, capped by line and character budgets, each line split into `{n, job, step, at, text}`). `gm.describe` names them `ci_status` and `ci_log`, because dispatch accepts either spelling. Gates `prd-all-closed`, `mutables-all-resolved`, `residual-scan-fired` and `worktree-clean` refuse move into COMPLETE while plan rows open, unknowns unresolved, residual scan not run, or worktree dirty.

## Configuration from your own repo

To change gm's prompts or gate text for one project, run `fsm-vendor` in that project. Writes compiled default prose and gate text into `.gm/instructions/`. Vendored file wins over configuration repository for same key; delete local file to fall back to repository.

`gm-config/gm.config.json` sets sync settings: `sync.debounce_ms` is 15000, so runner checks configuration repository at most once every 15 seconds. Default configuration repository is AnEntrypoint/gm-config, the `gm-config/` submodule listed in `.gitmodules`.

**Configuration repository controls gm's behavior in project, including its gate hooks, so point project's configuration only at repository you trust.**

gm reads served prose from three tiers, in order: project vendored file in `.gm/instructions/`, then cached configuration repository, then compiled default. Tier that cannot be used makes gm serve compiled default and emit `prose_tier_degraded` event. Unreachable configuration repository makes gm serve compiled default and record reason in `.gm/exec-spool/.config-repo-unreachable.json`.

## Memory

`.gm/memories/<key>.md` is durable per-project memory store, with lean cache index in `.gm/gm.db`. Generated `.gm/memories/mem-*.md` recall memos rebuilt from `gm.db`, not tracked by git. `search_with_recency` (`rs-plugkit/crates/plugkit-core/src/rssearch_vectors.rs`) ranks memories by meaning: each memory stored with embedding (vector placing text by meaning), score blends similarity with recency. Recency half-life 30 days. Embeddings computed on machine by shared `agentplug-bert` plugin.

## Developing gm itself

Root `.gitmodules` lists 10 submodules:

- `rs-plugkit/`: WASM guest, compiled to WebAssembly. Holds orchestrator, gates, spool dispatch.
- `agentplug/`: native host, `agentplug-runner`, loads WASM guest.
- `agentplug-bert/`, `agentplug-libsql/`, `agentplug-treesitter/`: shared native plugins for embeddings, storage, syntax parsing.
- `agentplug-crux/`: signal-concentration engine. Surfaces statistically rarest shapes in large, low-signal-density corpora.
- `rs-codeinsight/`: tree-sitter codebase analyzer.
- `rs-search/`: reciprocal rank fusion and tokenization library that `plugkit-core` crate of `rs-plugkit` consumes.
- `gm-mcp/`: MCP wrapper and its committed server bundle.
- `gm-config/`: default configuration repository. Holds prose, graph, gate hooks, policy data.

Gate predicate registry: `rs-plugkit/crates/plugkit-core/src/orchestrator/predicate_registry.rs`. Predicate graph names but registry lacks refused as `fsm_unknown_predicate`, so registry is source of truth. Advisory gates: `lean-contract-only-description` and `lean-verifier-independent`.

`node bin/gm-install.js` takes `--mcp-only` (repair MCP registration without reinstalling), `--skills-only`, `--check-skills`, `--force-link`, and `-g` or `--global`.

`gm-mcp/` ships no test tree. `no-synthetic-test-files` gate is diff-scoped (`gm-config/fsm/predicates.md`): refuses test file or test directory diff introduces, not one already existing.

Clone with submodules:

```
git clone --recurse-submodules https://github.com/AnEntrypoint/gm.git
```

Existing checkout:

```
git submodule update --init --recursive
```

Empty submodule directory is normal. Matters only when you change one of dependency repositories themselves. Contributors: see [CONTRIBUTING.md](./CONTRIBUTING.md) for bug reports and pull requests.

## Release pipeline

Push to `main` that changes `skills/**` starts `.github/workflows/skill-release.yml`. Workflow bumps patch version in `package.json`, packages skills into `gm-skill-<version>.tar.gz`, adds SHA-256 sidecar, publishes both to tagged GitHub Release. Release uses no npm registry.

Other workflows in `.github/workflows/`: `bump-pins.yml`, `contracts.yml` (checks verb and contract surfaces of `rs-plugkit`, `agentplug`, `gm-mcp`), `discipline-tree.yml`, `doc-drift.yml`, `gh-pages.yml` (builds flatspace site, adds `docs/api` JSON files, publishes to GitHub Pages), `house-clean.yml`, `link-check.yml` (weekly check that every external link in README, docs, site, skills answers), `npx-route.yml` (guards npx install command), and `process-leak.yml`.

WASM guest, `plugkit-slim.wasm`, built from `rs-plugkit`, published to `AnEntrypoint/plugkit-bin` releases. `agentplug-runner` native host fetches it at runtime. Repository ships Rust source for it, not compiled binary.

## Donations

BTC: `15FLMay4of9rk4jK2davzzL4HDdGQtscGX`

## License

MIT