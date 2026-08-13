---
name: gm-continue
description: The mandatory final handoff after a gm walk reaches phase=COMPLETE with prd_pending_count=0. Never end a gm session with prose alone -- dispatch this skill instead. It searches for genuinely remaining work and reloads gm if any exists; if gm already ran a full walk without resolving everything, it loads wfgy-method instead to apply bounded-retry-then-surface discipline before any further gm re-entry. Use immediately after any gm chain reaches its terminal state, never as a substitute for gm itself.
allowed-tools: Skill, Read, Write, Bash(bun *), Bash(npx *)
---

# gm-continue

This is the only allowed next step when a `gm` walk reaches `phase=COMPLETE AND prd_pending_count=0`. Never end that turn with prose alone -- dispatch this skill instead, every time, no exceptions for "it looks finished."

**This skill itself has exactly two allowed ways to end, and no others.** (1) Dispatch `Skill(skill="gm")` with the remaining PRD rows (found reachable work, or reopened an `external`/`out-of-reach` row, or this is the first confirming pass this session) -- `gm` then runs and, when it reaches COMPLETE again, calls back into this same skill. (2) Confirm there are no remaining PRD rows and none can be added -- a real, witnessed check (steps 2-4 below actually run, not assumed), not a feeling of "probably done." There is no third path: no prose-only stop that isn't outcome (2), no deferring to the user to decide whether to continue, no partial confirmation. Every dispatch of this skill lands in exactly one of these two states before the turn ends.

## What this skill does

1. Read `.gm/exec-spool/.turn-summary.json` for the current `phase`, `prd_pending`, and how many times this repo has already round-tripped through `gm-continue` this session (track via a counter file, see below).
2. Read `.gm/prd.yml` and `.gm/mutables.yml` directly for any row marked `blockedBy: [external]`/`[out-of-reach]` or otherwise deferred. **A prior `external`/`out-of-reach` marking is not a closed door -- it is remaining work by definition.** Re-examine each one now: is the blocker still genuinely unreachable this turn, or was it marked that way under time/scope pressure when it was actually solvable? Anything reachable now goes back into scope, re-`prd-add`'d (re-scope the existing id, never delete-and-re-add) as work to actually solve, not left marked external.
3. Fan out `codesearch` + `recall` against the ORIGINAL request's full closure, not against memory of what was already done -- a fresh look, same discipline as `gm`'s own PLAN orient.
4. If `.gm/prd.yml` has ANY items at all (pending, or reopened `external` rows from step 2), that alone is remaining work -- skip straight to the dispatch below, no further search needed.
5. Two outcomes, decided by what steps 2-4 actually find:
   - **Real remaining work found** (any PRD item at all, a reopened external/out-of-reach row, an unaddressed noun from the request, an edge case never exercised, a residual never triaged, a sibling repo never checked): dispatch `Skill(skill="gm")` and instruct it explicitly to finish ALL remaining tasks in `.gm/prd.yml` and fix any issues that arise while doing so -- not a narrow slice, not "just the reopened ones." Tell it plainly what was found so it lands directly in PLAN with real rows, not a blind re-orient.
   - **Nothing found, but this is the first `gm-continue` dispatch this session**: dispatch `Skill(skill="gm")` anyway, once, to let a full independent PLAN pass confirm it from inside `gm`'s own discipline (fresh `codesearch`/`recall`, `prd_pending_count=0` reached with nothing new added). That confirming turn inside `gm` is the actual stopping point -- prose-only is earned there, not here.
   - **Nothing found, and `gm-continue` already ran that confirming pass this session** (counter >= 1): the loop is closed. Prose-only summary is authorized. Do not dispatch anything further.

## When to load `wfgy-method` instead of `gm`

If a prior `gm` walk reached COMPLETE but the same class of gap keeps recurring across repeat `gm-continue` invocations (the confirming pass itself found new work more than once, or a stuck-loop-escalation was seen during the walk), dispatch `Skill(skill="wfgy-method")` instead of reloading `gm` directly. Apply its BBCR bounded-retry-then-surface discipline first -- checkpoint, name the unresolved tension, surface it plainly -- before any further `gm` re-entry. Reloading `gm` blind into a recurring gap repeats the same failure; `wfgy-method` exists to break that specific pattern.

## Recursion bound

Track invocation count in `.gm/.gm-continue-count` (plain integer, reset by a fresh user prompt). This skill dispatches `gm` or `wfgy-method` at most twice per user turn before it is required to stop and report to the user directly: once to check, once more only if that check found real work and the subsequent `gm` walk needs its own confirming `gm-continue` pass. A third consecutive "nothing new, re-check again" cycle is itself the stuck-loop signal -- surface it, do not keep looping silently.

## Never a substitute for `gm`

This skill does no PRD work, no EXECUTE, no EMIT, no VERIFY itself -- it only orients, decides, and hands off. All actual work happens inside `gm` (or `wfgy-method`'s recovery discipline), dispatched via `Skill`, never inlined here.
