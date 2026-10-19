---
name: gm-continue
description: The mandatory final handoff after a gm walk reaches phase=COMPLETE with prd_pending_count=0. The agent shall never end a gm session with prose alone, and shall dispatch this skill instead. Searches for remaining work and reloads gm if any exists, or loads wfgy-method if a walk already repeated the same gap. Use immediately when any gm chain reaches its terminal state, never as a substitute for gm itself.
---

# gm-continue

When a `gm` walk reaches `phase=COMPLETE AND prd_pending_count=0`, the agent shall dispatch this skill, the only allowed next step, every time. It shall never end that turn with prose alone, even for "it looks finished."

**This skill itself has exactly two allowed ways to end, and no others.** (1) Dispatch the `gm` skill with the remaining PRD rows (found reachable work, or reopened an `external`/`out-of-reach` row, or this is the first confirming pass this session) -- `gm` then runs and, when it reaches COMPLETE again, calls back into this same skill. (2) Confirm there are no remaining PRD rows and none can be added -- a real, witnessed check (steps 2-4 below actually run, not assumed), not a feeling of "probably done." There is no third path: no prose-only stop that isn't outcome (2), no deferring to the user to decide whether to continue, no partial confirmation. The one exception is a world-scoped one-way door (`skills/gm/SKILL.md` Section 4): ask the user only before deleting anything with no recoverable copy, spending money, reaching another person, changing production, or any legal, medical, financial or safety consequence for a real person, never to choose between options that make progress. Every dispatch of this skill lands in exactly one of these two states before the turn ends.

## What this skill does

1. Read `.gm/exec-spool/.turn-summary.json` for the current `phase`, `prd_pending`, and how many times this repo has already round-tripped through `gm-continue` this session (track via a counter file, see below).
2. Read `.gm/prd/` and `.gm/mutables/` directly -- one file per row, `<id>.yml` -- for any row marked `blockedBy: [external]`/`[out-of-reach]` or otherwise deferred. **A prior `external`/`out-of-reach` marking is not a closed door -- it is remaining work by definition.** Re-examine each one now: is the blocker still genuinely unreachable this turn, or was it marked that way under time/scope pressure when it was actually solvable? Anything reachable now goes back into scope, re-`prd-add`'d (re-scope the existing id, never delete-and-re-add) as work to actually solve, not left marked external.
3. Fan out `codesearch` + `recall` against the ORIGINAL request's full closure, not against memory of what was already done -- a fresh look, same discipline as `gm`'s own PLAN orient.
3a. **Re-read the user's literal words from this turn, then exercise the live system now to check the shipped behavior against them.** No test file, prior PRD `witnessed` mark, or recollection of the fix counts as evidence -- `prd_pending_count=0` only proves no row is open, not that closed rows match what was actually asked, and a row resolved in the same pass as its own check can share that check's misreading. Run the real path the user would use and read the real output. Any mismatch is remaining work, `prd-add`'d fresh.
4. If `.gm/prd/` holds ANY row file at all (pending, or reopened `external` rows from step 2), that alone is remaining work -- skip straight to the dispatch below, no further search needed. A row that is gone from the folder was resolved and moved into `.gm/prd-log.jsonl`; check the log, never the folder, when you need to know what was already closed.
5. Two outcomes, decided by what steps 2-4 actually find:
   - **Real remaining work found** (any PRD item at all, a reopened external/out-of-reach row, an unaddressed noun from the request, an edge case never exercised, a residual never triaged, a sibling repo never checked): dispatch the `gm` skill and instruct it explicitly to finish ALL remaining tasks in `.gm/prd/` and fix any issues that arise while doing so -- not a narrow slice, not "just the reopened ones." Tell it plainly what was found so it lands directly in PLAN with real rows, not a blind re-orient.
   - **Nothing found, but this is the first `gm-continue` dispatch this session**: dispatch the `gm` skill anyway, once, to let a full independent PLAN pass confirm it from inside `gm`'s own discipline (fresh `codesearch`/`recall`, `prd_pending_count=0` reached with nothing new added). That confirming turn inside `gm` is the actual stopping point -- prose-only is earned there, not here.
   - **Nothing found, and `gm-continue` already ran that confirming pass this session** (counter >= 1): the loop is closed. Prose-only summary is authorized. The agent shall not dispatch anything further.

## When to load `wfgy-method` instead of `gm`

If a prior `gm` walk reached COMPLETE but the same class of gap keeps recurring across repeat `gm-continue` invocations (the confirming pass itself found new work more than once, or a stuck-loop-escalation was seen during the walk), dispatch the `wfgy-method` skill instead of reloading `gm` directly. Apply its BBCR bounded-retry-then-surface discipline first -- checkpoint, name the unresolved tension, surface it plainly -- before any further `gm` re-entry. Reloading `gm` blind into a recurring gap repeats the same failure; `wfgy-method` exists to break that specific pattern.

## Recursion bound

Track invocation count in `.gm/.gm-continue-count` (plain integer, reset by a fresh user prompt). This skill dispatches `gm` or `wfgy-method` at most twice per user turn before it is required to stop and report to the user directly: once to check, once more only if that check found real work and the subsequent `gm` walk needs its own confirming `gm-continue` pass. A third consecutive "nothing new, re-check again" cycle is itself the stuck-loop signal -- surface it, do not keep looping silently.

## Never a substitute for `gm`

This skill does no PRD work, no EXECUTE, no EMIT, no VERIFY itself -- it only orients, decides, and hands off. All actual work happens inside `gm` (or `wfgy-method`'s recovery discipline), dispatched via `Skill`, never inlined here.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
