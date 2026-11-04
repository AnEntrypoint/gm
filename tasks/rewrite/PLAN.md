# Remaining work for the native gm-new (2026-11-04)

Baseline: commit df0a6b9 on origin main. Native core, leaves, host and relay build and pass 11/11 ctest. Live Node runtime (src/, tools/) is unchanged and is the reference.

Gates: cutover (M5, .mcp.json points at the native binary) only after the parity harness (M3) shows no diffs on the verb groups and the MCP script. Comment sweep and the native AGENTS.md come last.

Workstreams (parallel now):
- cli: gmnew events --dir D [--wait] and gmnew query --dir D --js E, same output as src/cli.mjs. Brief: cli.md.
- mcp-parity: pending events and pendingCommands, jobs notices, durMs and startMono, feed compaction, finish rules per the current skills/gm/SKILL.md, background run_code and budgets, replay on resume. Brief: mcp-parity.md.
- codeast-wiki-review: callers, impact, wiki_search, wiki_write, review_* as JavaScript leaves, with acorn vendored. Brief: codeast-wiki-review.md.
- parity-harness: drives the Node reference (committed HEAD, extracted to /tmp) and the native worker with the same JSON-RPC script and diffs them. Brief: parity-harness.md.
- ci-setup: GitHub workflows for the native build on the six targets, and setup and README text for native. Brief: ci-setup.md.
- verbs-jobs: job snapshot for the MCP server, query_log js through QuickJS. Brief: verbs-jobs.md.

Coordination: pending queue file format is defined by src/pending.mjs and is written by mcp-parity and read by cli. Node reference for every comparison is the committed HEAD, never the live working tree, because another session has uncommitted edits to src/mcp.mjs, skills/gm/SKILL.md and AGENTS.md.
