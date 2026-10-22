---
name: gm-continue
description: The mandatory final handoff after a gm walk reaches phase=COMPLETE with prd_pending_count=0. The agent shall never end a gm session with prose alone, and shall dispatch this skill instead. Searches for remaining work and reloads gm if any exists, or loads wfgy-method if a walk already repeated the same gap. Use immediately when any gm chain reaches its terminal state, never as a substitute for gm itself.
---

# gm-continue

When a `gm` walk reaches `phase=COMPLETE AND prd_pending_count=0`, dispatch this skill every time. Never end that turn with prose alone, even for "it looks finished."

This skill has exactly two allowed endings:
1. Dispatch `gm` with the remaining PRD rows (reachable work found, a reopened `external`/`out-of-reach` row, or the first confirming pass this session). When `gm` reaches COMPLETE again, it calls back into this skill.
2. Confirm there are no remaining PRD rows and none can be added, by a real witnessed check (steps 2-4 actually run, not assumed).

No other prose-only stop, no deferring to the user, no partial confirmation. The one exception is a world-scoped one-way door (`skills/gm/SKILL.md` Section 4): deleting anything with no recoverable copy, spending money, reaching another person, changing production, or any legal, medical, financial or safety consequence for a real person. Never ask to choose between options that make progress.

## What this skill does

1. Read `.gm/exec-spool/.turn-summary.json` for `phase`, `prd_pending`, and the round-trip count (Recursion bound).
2. Read `.gm/prd/` and `.gm/mutables/` directly, one file per row (`<id>.yml`), for any row marked `blockedBy: [external]`/`[out-of-reach]` or otherwise deferred. That marking is not a closed door; it is remaining work by definition. Re-examine each: still genuinely unreachable this turn, or marked under time/scope pressure when it was solvable? Reachable rows go back into scope by re-`prd-add`ing the existing id (re-scope, never delete-and-re-add).
3. Fan out `codesearch` + `recall` against the ORIGINAL request's full closure, not memory of what was done: a fresh look, same discipline as `gm`'s PLAN orient.
3a. Re-read the user's literal words from this turn, then exercise the live system to check shipped behavior against them. No test file, prior PRD `witnessed` mark, or recollection counts as evidence: `prd_pending_count=0` only proves no row is open, and a row resolved in the same pass as its own check can share its misreading. Run the real path the user would use and read its output. Any mismatch is remaining work, `prd-add`'d fresh.
4. If `.gm/prd/` holds ANY row file (pending, or reopened `external` rows from step 2), that alone is remaining work: dispatch straight away. A row gone from the folder was resolved and moved to `.gm/prd-log.jsonl`; check the log, never the folder, for what was closed.
5. Two outcomes:
   - **Real remaining work** (any PRD item, reopened external/out-of-reach row, unaddressed noun from the request, unexercised edge case, untriaged residual, unchecked sibling repo): dispatch `gm` and instruct it to finish ALL remaining tasks in `.gm/prd/` and fix issues that arise on the way, not "just the reopened ones." State what was found so it lands directly in PLAN with real rows.
   - **Nothing found, first dispatch this session**: dispatch `gm` once anyway, so a full independent PLAN pass confirms from inside `gm` (fresh `codesearch`/`recall`, `prd_pending_count=0` with nothing added). That confirming turn inside `gm` is the actual stopping point.
   - **Nothing found, confirming pass already ran** (counter >= 1): the loop is closed. A prose-only summary is authorized. Dispatch nothing further.

## When to load `wfgy-method` instead of `gm`

If a prior `gm` walk reached COMPLETE but the same class of gap recurs across repeat `gm-continue` invocations (the confirming pass found new work more than once, or a stuck-loop escalation was seen), dispatch `wfgy-method` instead of reloading `gm`. First apply its BBCR bounded-retry-then-surface discipline (checkpoint, name the unresolved tension, surface it plainly). Reloading `gm` blind into a recurring gap repeats the failure.

## Recursion bound

Track invocations in `.gm/.gm-continue-count` (plain integer, reset by a fresh user prompt). Escalation is unbounded: this skill dispatches `gm` or `wfgy-method` as many times as the open rows need, with no per-turn cap. A lane that cannot close its row escalates in this order, and every refusal routes here rather than ending the lane: (1) `gm` reloaded for that lane's row; (2) when the same gap recurs, `wfgy-method`, which checkpoints, names the unresolved tension and retries on the next route; (3) back to `gm` with what wfgy named. The turn never ends with pending rows: it runs the next round on the remaining rows. Refusal is impossible: a lane that stops with a row open is a defect, not a finished lane.

## Never a substitute for `gm`

This skill does no PRD work, no EXECUTE, no EMIT, no VERIFY. It orients, decides and hands off. All work happens inside `gm` (or `wfgy-method`'s recovery discipline), dispatched via `Skill`, never inlined here.

## Finish the work

- Finishing the requested work is the goal of every run. A run that stops with work undone is incomplete.
- A blocking issue (failing check, tool or service fault, missing input, network or environment fault) is fixed in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue.
- Stop only when the work is complete, or a step is still blocked after every route; then report the blocked step, the routes tried, and the evidence for each.
