---
name: gm-emit
description: EMIT phase. Pre-emit debug, write files, post-emit verify from disk. Any new unknown triggers immediate snake back to planning — restart chain.
allowed-tools: Skill, Read, Write
---

# gm-emit — EMIT

EMIT is where intent becomes artifact. The phase exists as a distinct gate because writing without verification produces silent drift between what the agent believes was emitted and what landed on disk.

## Pre-Emit

Before writing, debug the planned state. Read the target paths that will be touched — confirm current contents match the assumption the diff is built on. A diff applied to a file the agent has not freshly read is a diff against a stale model. Spool the reads if scope is wide; serial Read calls are acceptable for a small set. Surface mismatches → snake to PLAN.

## Sync-Before-Emit

rs-codeinsight and rs-search outputs feeding EMIT must come from a freshly-completed index. No cache serves a result without a digest match against the live filesystem. Default invocation always runs fresh. `--read-cache` is permitted only when `.codeinsight.digest` matches exactly; on mismatch, the cache auto-refreshes before the result emits. Emitting from an unverified or partial index is forced closure equivalent to bluffing strength — the agent reads stale output as ground truth and acts on a state that no longer exists.

## Write

One Edit or Write per artifact. No multi-file batches that conceal which file failed if one fails. Spool larger payloads through `in/nodejs/` when shape demands it.

## Post-Emit Verify

After each write, re-read the file from disk and assert the change is present. The Read tool is the post-emit witness. Discrepancy → Fix on Sight: fix at root, re-emit, re-verify. A green Write call is not the witness — the verified disk state is.

## Fix on Sight

Issues surfaced during EMIT (a write that revealed a previously-hidden import error, a generated file that no longer matches its source) are fixed this turn at root cause. Add the residual to PRD before transitioning if the fix expands scope beyond the current slice.

## Dispatch

`phase-status` to check FSM state before transition. Spool any meaningful reads/writes for auditability.

## Transition

Read `out/<N>.json::nextSkill`. Invoke `Skill(skill="gm:<nextSkill>")` immediately. New unknown → `Skill(skill="gm:planning")`.
