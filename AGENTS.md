# AGENTS.md

## Purpose

This repository publishes the `gm-skill` release artifact. The installed `/gm` skill is `skills/gm/SKILL.md`. The agent drives the state machine; `rs-plugkit` serves it through spool verbs.

Read `SKILLS.md` before starting work. Read every relevant `skills/<name>/SKILL.md` before using that skill. The served `instruction` response, project configuration, and the applicable skill override this file when they conflict.

## Ownership

- `skills/gm/SKILL.md` owns agent workflow and tool routing.
- `gm-config/` owns default phase prose, gate text, residual text, and the FSM graph. Project-local vendored configuration takes precedence; compiled prose is a fallback.
- `rs-plugkit/` is the WASM guest that implements orchestration, spool verbs, memory, and code search.
- `agentplug/` provides `agentplug-runner`, the native WASM host. It is the only supported loader.
- `gm-mcp/` wraps the spool write-and-poll cycle. Edit `src/` and rebuild its committed bundle together.
- `install.sh` and `install.ps1` install the skill and runner. Keep their platform behavior equivalent.

The root is the published package. `package.json` lists release contents. `skill-release.yml` publishes skill changes from `main`; do not assume a release succeeded without its workflow result.

## Working with gm

Use the `gm` skill for engineering work. Prefer its MCP server. Without it, use the documented spool fallback: write one complete request atomically, prefix every request number with a unique session id, and poll the matching response. Never start a second watcher while a fresh watcher is busy. A stale or failed runner is a defect in its owning source, not a reason to bypass gm.

Use the verbs exposed by the running plugin for search, browser, git, execution, memory, and state changes. Do not substitute platform-native tools when the matching verb exists. Read known runtime-state files directly only when the skill allows it.

The on-disk PRD and mutable state is authoritative. A walk completes only when the live state machine accepts `COMPLETE`, all required rows are closed, and `gm-continue` has checked for remaining work.

Give each subagent its own session id and tell it to use the gm skill. Parallelize independent work, but assign one writer to each shared surface. A submodule change includes updating the parent pin.

## Implementation rules

- Keep code and prose self-explanatory. Retain a comment only for a local fact that structure cannot express, such as a measured limit or an external workaround.
- Do not add synthetic tests, mocks, placeholders, or decorative glyphs. Verify behavior through the actual build and a live spool dispatch.
- Keep tracked text UTF-8 without a BOM.
- Use atomic create or rename for every single-writer and lock guard.
- Treat configuration prose keys and source paths as untrusted relative paths. Accept only safe components. Accept config repositories only through approved remote transports. Keep fetch HTTP(S)-only with a nonempty authority.
- Treat durable memory as source. Keep only current, reusable facts. Remove resolved incident narration and duplicate guidance instead of growing the corpus.
- Keep documentation current, present-tense, and concise. Put detailed protocol, release, and incident material in its owning README, source, or changelog rather than duplicating it here.
- Keep this file below 30 KB. When it exceeds that limit, revalidate it against current source, history, and retained memory before compacting it.

## Verification and delivery

Verify the changed surface with its real entry point. For `rs-plugkit`, build the guest and witness the changed verb through `agentplug-runner`. For `gm-mcp`, rebuild the bundle when its source or input schema changes. For release-facing changes, inspect the relevant workflow and resulting artifact.

Use the gm git verbs. Before delivery, resolve every residual, keep the worktree clean, update affected submodule pins, and verify the remote state. Do not claim completion from source inspection alone.
