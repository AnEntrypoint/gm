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
- `bin/gm-install.js` registers the MCP server as `node ~/.gm-tools/gm-mcp-server.mjs` (project `.mcp.json`: a `node -e` launcher resolving that path at start). Never register an `npx github:` spec: it re-resolves and reinstalls over the network on every connect (measured 8.2s warm, 22.2s cold, vs 0.19s local) and trips Claude Code's 30s `CONNECT_TIMEOUT` under load.

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

## Verified 2026-09-14 (upstream merge + daemon heartbeat)

**FIXED UPSTREAM, verified here — the daemon "looks dead" bug.** `registry.rs`'s
own comment records it: `slot_content_hashes()` takes each slot's mutex, so the
10s heartbeat ticker blocked behind whatever dispatch held the slot and went
**76 seconds stale**; every client then read the status as stale, concluded the
daemon was dead, and spawned a competing one. That is the daemon start/exit churn
that follows a slow dispatch, and it is exactly what repeatedly bit the docstudio
sessions — a `git_commit` with a large message would appear swallowed, the status
`ts` would look minutes old, the daemon would be killed and restarted, and the
dispatch was lost in the churn.

`slot_snapshot_without_blocking()` fixes it. Re-verified on runner 0.1.135 by
driving a real 75-second `exec_js` (it genuinely held a slot — status read `busy`
throughout, and the verb returned `exit_code:0`, "held a slot for 75075ms") while
polling `.status.json` every 5s: **worst heartbeat age 2,964 ms** against a
300,000 ms dead-threshold. It never came close to looking dead.

Method note: the first attempt at this measurement was INVALID and said so only
because the out-file was read. Hand-writing the dispatch into the spool bypassed
the MCP path, so it was `gate_denied` (`long-gap-no-instruction`) and never ran —
the heartbeat stayed fresh because the daemon was idle, not because the fix
worked. Always confirm the long verb actually executed before believing a
liveness measurement taken "during" it.

**STILL BROKEN — `serp`/oxibrowser navigates but serves an empty document.**
Reproduced on oxibrowser 0.18.3 (plugin gm 0.1.1296). `url=https://example.com`
returns `ok:true` and JS sees the right `location.href` ("https://example.com/")
and `readyState:"complete"` — so it is the same session and navigation reported
success — but `document.documentElement` is **null**, `outerHTML` length 0, and
all three read paths come back empty: `evaluate` (`NO BODY`), `dom=h1` (ok with
no matches), and `extract-markdown` (`markdown: ""`).

Narrowed, not fixed: `Session::navigate` (oxibrowser-core/src/session.rs:545)
looks correct — it fetches, errors on >=400, builds `Page::from_html`, sets
`active_page` and calls `inject_dom_snapshot()`. The `document.documentElement`
getter (js/runtime.rs:5465) is also correct, returning null only when both the
render doc and the DOM snapshot are empty. So the break is between
`inject_dom_snapshot()` and the JS realm the plugin's `evaluate` runs in. Left
for the obrowser repo rather than patched speculatively from here: it is a young
engine (2 commits), the lifecycle involved is substantial, and `browser`
(lightpanda) and `cdp` (real Chrome) both work and are the documented fallbacks,
so nothing is blocked by this.
