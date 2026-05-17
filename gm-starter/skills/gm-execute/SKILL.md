---
name: gm-execute
description: EXECUTE phase AND the foundational execution contract for every skill. Every spool dispatch run, every witnessed check, every code search, in every phase, follows this skill's discipline. Resolve all mutables via witnessed execution. Any new unknown triggers immediate snake back to planning — restart chain from PLAN.
allowed-tools: Skill, Read, Write
---

# gm-execute — EXECUTE

Every PRD item resolves through witnessed execution. Real input through real code into real output, witnessed. Anything less leaves the mutable open.

## Fix on Sight

Every issue surfaced during work is fixed in-band, this turn, at root cause. Defer-markers, swallowed errors, suppressed output, skipped tests, and "address it next session" are variants of the same failure: a known-bad signal carried past the moment of detection. Surface → diagnose → fix at root → re-witness → continue. Pre-existing build breaks, lockfile drift, broken deps, lint failures on neighboring code, stale generated files — all become PRD items the same turn they surface, executed before COMPLETE. The user does not have to ask. Genuinely out-of-reach errors (require credentials, depend on down services, demand product decisions) are named with `blockedBy: external` in the PRD — never silently dropped.

## Surprise Absorption Prohibition

Every unexpected output is a new mutable. The agent that absorbs surprise into its existing model — "that output is weird but the test still passes" — has just resolved an unknown by narrative, which the discipline rejects on principle. Snake back to PLAN, name the new mutable, witness it, resume. The two-pass rule applies: first pass exposes the surprise, second pass either witnesses the new mutable or proves the surprise was a measurement artifact.

## Nothing Fake

What ships runs against real services, real data, real binaries. Stubs, mocks, placeholder returns, fixture-only paths, "TODO: implement", hardcoded sample responses, and demo-mode fallbacks are forbidden. They produce green checks that survive into production and lie about what works. Behavioral detection: code paths that always succeed, always return the same value regardless of input, or short-circuit a real call to satisfy a type signature are stubs. Before writing a shim, check whether an upstream library already provides that surface — maintaining a local reimplementation drifts and ages.

## Browser Witness

Editing code that runs in a browser requires a live `exec:browser` witness in the same turn as the edit. Boot the real surface (server up, page reachable, HTTP 200 witnessed), navigate, poll for the global the change affects, `page.evaluate` asserting the specific invariant, capture witnessed values. Variance → fix at root → re-witness. Pure-prose edits to static documents with no JS/canvas/DOM behavior change are exempt with the exemption tagged. Silent skip on actual behavior change is forced closure.

## Mutables Resolve

The `mutable-resolve` verb auto-fires memorize on success. `witness_evidence` is mandatory — file:line, codesearch hit, exec output snippet. Narrative resolution is rejected. Rows that cannot be witnessed stay `unknown` and the EMIT gate stays closed.

## Dispatch

Spool every exec. `mutable-resolve` to flip rows. `phase-status` to read FSM state. `transition` when the PRD slice for this phase is complete.

## Transition

Read `out/<N>.json::nextSkill`. Invoke `Skill(skill="gm:<nextSkill>")` immediately. New unknown surfaces → snake to `Skill(skill="gm:planning")`, restart chain.
