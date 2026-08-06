---
name: agent-memory
description: Sets up and drives TencentDB Agent Memory (MemoryCore + MemoryHub + MemoryProxy + MemoryPanel, from AnEntrypoint/agent-memory) -- a persistent, cross-session memory and knowledge system for AI agents distinct from this project's own recall/memorize-fire store. Chat Memory (L0 conversation -> L1 atom -> L2 scenario -> L3 persona), a versioned Skill library extracted from past work, a Wiki + CodeGraph knowledge map over docs and code, and a human-controlled review panel. Use when the user wants an agent team to share and accumulate memory/skills/knowledge across sessions and across multiple agent frameworks (not just this one Claude Code session), when they mention "memory hub", "team memory", "chat memory", "skill library", "wiki", "codegraph", or ask to install/configure/troubleshoot the memory-tencentdb plugin, or when onboarding a new agent into an existing team's accumulated experience. Not for this project's own internal recall/memorize-fire mechanism -- that is a separate, unrelated store.
license: MIT
compatibility: Requires Docker (or Node.js >= 22.16 for source install) to run MemoryCore/MemoryHub/MemoryProxy services locally or self-hosted; a running LLM endpoint (OpenAI-compatible) for extraction/embedding. Panel UI served over HTTP. Verified against AnEntrypoint/agent-memory (published fork of TencentCloud/TencentDB-Agent-Memory).
metadata:
  origin: AnEntrypoint/agent-memory
  upstream: TencentCloud/TencentDB-Agent-Memory
  provenance: published-fork-repackaged-as-skill
allowed-tools: Skill, Read, Write, Bash, WebFetch
---

# agent-memory

TencentDB Agent Memory gives an agent team a shared, growing memory instead of starting cold every session. It is a separate system from this project's own `memorize-fire`/`recall` store (see `wfgy-method`/`gm` skills for that) -- reach for `agent-memory` when the ask spans multiple agent frameworks, multiple team members, or needs a human-reviewable panel, not just this single Claude Code session's local recall.

## What it provides

- **Chat Memory**: retains preferences, facts, decisions, and interaction history per agent. Distilled in layers: L0 raw conversation -> L1 atom -> L2 scenario -> L3 persona.
- **Skill library**: after complex work, an agent can extract a reusable Skill (versioned, with resource files, trigger boundaries, execution steps, validation rules) from its own conversation/tool-call history, then share it with the team after review.
- **Wiki + CodeGraph**: turns docs/specs/runbooks into a linked Wiki; indexes code symbols, files, call relationships, and impact paths into a CodeGraph, both queryable on demand rather than injected wholesale into context.
- **Memory Panel**: a human-controlled review/control surface (not just a dashboard) for what gets promoted, shared, or pruned.

Assets are portable across agent frameworks and shareable across a team -- a new agent or team member can load existing memory instead of relearning from scratch.

## When to use this skill vs. this project's own memory

- Use `agent-memory` when: the user explicitly names TencentDB/memory-tencentdb/Memory Hub/team memory, wants memory that survives across *different* agent frameworks or team members (not just this session), wants a Skill library extracted from past conversations, or wants a Wiki/CodeGraph over a codebase.
- Do NOT use this for the recall/memorize-fire mechanism already built into `gm`/`wfgy-method` -- that is this project's own local memory and is unrelated infrastructure.

## Setup

### 1. Fastest path: Docker Compose (all three services)

```bash
git clone https://github.com/AnEntrypoint/agent-memory.git
cd agent-memory/deploy/global-images
cp .env.example .env
$EDITOR .env       # fill in LLM params for both the memory group and the proxy group
./start-all.sh     # starts memory-core + memory-hub + proxy; prints a one-liner for Claude Code setup
```

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

Zero-config works for basic capability. Production tuning groups: `capture`, `extraction`, `pipeline`, `recall`, `persona`, `embedding` -- see `references/openclaw-config.md` for the full recommended template and failure-mode notes (embedding four-tuple, retention-day gating, etc.).

### 3. Migrating from an older install (v1.x/v0.x -> v2.0.0+)

Use the migration tool documented at `MemoryCore/scripts/migrate-v2-to-v3/README.md` in the repo. New installs skip this.

## Verification (do this before declaring setup done)

1. Confirm version prerequisites: `node -v` (`>=22.16`), and `openclaw --version` (`>=2026.3.13`) if using the OpenClaw plugin path.
2. After start/restart, confirm the service actually came up -- read logs (`[memory-tdai]` prefix for the OpenClaw plugin path, or the relevant container logs for Docker Compose) rather than assuming success from a clean exit code.
3. Confirm the data directory exists and is non-empty (OpenClaw: `~/.openclaw/state/memory-tdai/` containing `conversations/`, `records/`, `scene_blocks/`, `vectors.db`).
4. Run a real round-trip: have 2-3 turns that state memorable facts, start a fresh session, and confirm recall actually surfaces that content (via the panel, or a search tool call such as `tdai_memory_search`/`tdai_conversation_search`). A missing recall on this smoke test means setup is not done -- do not report success from config-file presence alone.

## Common failure modes

- No logs at all: `memory-tencentdb.enabled` not `true`, or the gateway/service was never restarted after config changes.
- Records exist but nothing recalls: `recall.enabled` is false, or `recall.scoreThreshold` is too high.
- No vector results: the `embedding` config is missing one of `apiKey`/`baseUrl`/`model`/`dimensions` -- any single missing field silently degrades to keyword-only mode rather than erroring.
- History disappearing too fast: `l0l1RetentionDays` set too low (1-2) without explicitly enabling `allowAggressiveCleanup`.

## Security

Treat `embedding.apiKey` and any LLM credentials as sensitive -- do not echo them into chat, logs, or screenshots. Prefer environment-variable injection over literal values in config files. When editing config, touch only the `memory-tencentdb`/agent-memory section; do not overwrite unrelated plugin or service config.
