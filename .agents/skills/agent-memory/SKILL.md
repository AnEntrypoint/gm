---
name: agent-memory
description: Sets up and drives TencentDB Agent Memory (MemoryCore, MemoryHub, MemoryProxy, MemoryPanel) for agent teams. Use when the user mentions "memory hub", "team memory", "chat memory", "skill library", "wiki", "codegraph", or asks to install, configure or troubleshoot the memory-tencentdb plugin, onboard a new agent, or deploy standalone (Docker Compose, panel UI, team review).
license: MIT
metadata:
  origin: AnEntrypoint/agent-memory
  upstream: TencentCloud/TencentDB-Agent-Memory
  provenance: published-fork-repackaged-as-skill
allowed-tools: Read, Write, Bash
---

# agent-memory

Requires a running OpenAI-compatible LLM endpoint for extraction and embedding; Docker or Node.js >= 22.16 for the services.

TencentDB Agent Memory gives an agent team a shared, growing memory instead of starting cold every session. Two ways it relates to gm's own flat-file memory (see the `gm` skill for that): (1) as a fully standalone system (this skill's main content, below) when the ask spans multiple agent frameworks, multiple team members, or needs a human-reviewable panel; (2) as an opt-in storage backend for gm's own memory store (`memory.tencentdb_backend` in `.gm/gm.config.json`, disabled by default) -- when a namespace is routed to it, gm's memory store writes file-pointer-indexed content compatible with this system's format instead of gm's default 384-dim md-corpus store, with no change to how an agent reads or writes memory. Reach for THIS skill's setup instructions (Docker Compose, panel UI) for the standalone deployment; reach for `gm`'s own docs when the ask is just "make gm's memory use the Tencent-compatible backend."

## What it provides

- **Chat Memory**: retains preferences, facts, decisions, and interaction history per agent. Distilled in layers: L0 raw conversation -> L1 atom -> L2 scenario -> L3 persona.
- **Skill library**: after complex work, an agent can extract a reusable Skill (versioned, with resource files, trigger boundaries, execution steps, validation rules) from its own conversation/tool-call history, then share it with the team after review.
- **Wiki + CodeGraph**: turns documentation, specs and runbooks into a linked Wiki; indexes code symbols, files, call relationships, and impact paths into a CodeGraph, both queryable on demand rather than injected wholesale into context.
- **Memory Panel**: a human-controlled review/control surface (not just a dashboard) for what gets promoted, shared, or pruned.

Assets are portable across agent frameworks and shareable across a team -- a new agent or team member can load existing memory instead of relearning from scratch.

## When to use this skill vs. gm's own flat-file memory

- Use `agent-memory`'s standalone setup instructions when: the user explicitly names TencentDB/memory-tencentdb/Memory Hub/team memory, wants memory that survives across *different* agent frameworks or team members (not just this session), wants a Skill library extracted from past conversations, or wants a Wiki/CodeGraph over a codebase.
- Use the flat-file memory described in the `gm` skill (no setup) for this session's own local recall. If the user wants gm's own store to be Tencent-format compatible without running the standalone services, point them at `gm.config.json`'s `memory.tencentdb_backend` block instead of a full standalone install.

## Setup

### 1. Fastest path: Docker Compose (all three services)

```bash
git clone https://github.com/AnEntrypoint/agent-memory.git
# inside the clone: follow its Docker Compose deploy README
```

Configure the LLM parameters for the memory and proxy groups in `.env` before starting the services.
The start script runs MemoryCore, MemoryHub, and MemoryProxy, then prints the Claude Code setup command.
Open the panel at `http://localhost:8125`.

For a standalone Memory Hub, Proxy + Claude Code / CodeBuddy integration, port reference, and teardown, see `INSTALL.md` in the repo (`INSTALL_CN.md` for Chinese).

### 2. OpenClaw plugin install (if the host is OpenClaw, not Claude Code)

```bash
openclaw plugins install @tencentdb-agent-memory/memory-tencentdb
```

Minimal config in `~/.openclaw/openclaw.json`:

```json
{ "memory-tencentdb": { "enabled": true } }
```

Zero-config works for basic capability. Production tuning groups: `capture`, `extraction`, `pipeline`, `recall`, `persona`, `embedding` -- see the upstream plugin documentation for the full recommended template and failure-mode notes (embedding four-tuple, retention-day gating, etc.).

### 3. Migrating from an older install (v1.x or v0.x, to v2.0.0+)

Use the migration tool documented in the upstream repo's migration README. New installs skip this.

### 4. Migrating gm's own memories into the `tencentdb_backend` store

Import verb, batch script, the 384-dim requirement and the archive option: `references/migrate-gm-memories.md`.

## Verification (do this before declaring setup done)

1. Confirm version prerequisites: `node -v` (`>=22.16`), and `openclaw --version` (`>=2026.3.13`) if using the OpenClaw plugin path.
2. After start/restart, confirm the service actually came up -- read logs (`[memory-tdai]` prefix for the OpenClaw plugin path, or the relevant container logs for Docker Compose) rather than assuming success from a clean exit code.
3. Confirm the data directory exists and is non-empty (OpenClaw: `~/.openclaw/state/memory-tdai/` containing `conversations/`, `records/`, `scene_blocks/`, `vectors.db`).
4. Run a real round-trip: have 2-3 turns that state memorable facts, start a fresh session, and confirm recall actually surfaces that content (via the panel, or a search tool call such as `tdai_memory_search`/`tdai_conversation_search`). A missing recall on this smoke test means setup is not done -- do not report success from config-file presence alone.

## Common failure modes

- No logs at all: `memory-tencentdb.enabled` not `true`, or the gateway/service was never restarted after config changes.
- Records exist but nothing recalls: `recall.enabled` is false, or `recall.scoreThreshold` is too high.
- No vector results: the `embedding` config is missing one of `apiKey`/`baseUrl`/`model`/`dimensions` -- any single missing field disables vector search, logs an `[EMBEDDING CONFIG ERROR]` line at error level, and the plugin keeps running without embeddings instead of refusing to start.
- History disappearing too fast: `l0l1RetentionDays` set too low (1-2) without explicitly enabling `allowAggressiveCleanup`.

## Security

Treat `embedding.apiKey` and any LLM credentials as sensitive -- do not echo them into chat, logs, or screenshots. Prefer environment-variable injection over literal values in config files. When editing config, touch only the `memory-tencentdb`/agent-memory section; do not overwrite unrelated plugin or service config.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
