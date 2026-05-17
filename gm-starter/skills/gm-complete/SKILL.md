---
name: gm-complete
description: VERIFY and COMPLETE phase. End-to-end system verification and git enforcement. Any new unknown triggers immediate snake back to planning — restart chain.
allowed-tools: Skill, Read, Write
---

# gm-complete — VERIFY

COMPLETE is earned, not declared. Three preconditions: git clean, pushed to remote, CI green. Any one missing means the phase has not concluded.

## CI Is The Build

For Rust crates (rs-exec, rs-codeinsight, rs-search, rs-learn, rs-plugkit) and the gm publish chain, `git push` triggers the build matrix across six target platforms. `cargo build` and `cargo test` are not run locally — a local build covers exactly one platform and proves nothing about the other five. Push, watch CI, fix on red. Toolchain mismatches and rustc skew never block a push.

Watch protocol: after push, poll `gh run list --branch <branch> --limit 3 --json status,conclusion,name` until the run completes, up to `GM_CI_WATCH_SECS` (default 180). On red, triage the failure shape (import error → check manifests; type error → snake to PLAN; test failure → root cause; lint → fix in-band; build timeout → re-trigger once, else PRD `blockedBy: external`). Fix at root, push, re-watch. Green CI is the precondition for VERIFY → UPDATE-DOCS.

## Single Integration Test

One `test.js` at project root. 200-line hard cap. No fixtures, no mocks, no scattered test files. `gm-complete` runs it. Failure = regression to EXECUTE. Prefer compaction over expansion when editing: merge groups, drop redundancy.

## Residual-Scan Gate

Before allowing transition to update-docs, fire the `residual-scan` verb. Empty PRD is necessary but not sufficient — the gate asks what the agent should have decided to do but did not. Either re-enter planning with appended items and execute, or explicitly state "residual scan: none reachable in-spirit." The `.gm/residual-check-fired` marker makes this one-shot per stopping window. Common residuals: pre-existing build break surfaced this turn, neighboring lint failure, obvious refactor win, observability gap, doc drift, follow-on work the user clearly implied.

## Git Gate

`git status` clean. `git log` shows the commit pushed. `gh run list` shows the most recent run for the branch concluded green. All three witnessed before transition.

## Dispatch

`phase-status`, `transition`, `residual-scan`. Spool the CI watch through `in/bash/` so timeouts respect the spool budget.

## Transition

Residual-scan clear AND git clean AND CI green → `Skill(skill="gm:update-docs")`. Anything else → `Skill(skill="gm:planning")` or `Skill(skill="gm:gm-execute")` per the gap.
