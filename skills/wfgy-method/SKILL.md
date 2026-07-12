---
name: wfgy-method
description: Applies WFGY (Wan Fa Gui Yi), a portable reasoning discipline for reducing drift and incoherence across multi-step agent work, adapted from onestardao/WFGY's core mechanism. Compares each step against the stated goal, considers more than one approach before committing to ambiguous or high-stakes decisions, and checkpoints before risky steps so it can revert and bounded-retry instead of compounding a mistake. Records durable lessons in this project so future sessions inherit them. Use when starting any non-trivial multi-step task, when a task risks losing track of its original goal over many steps, when facing a decision with real alternatives worth comparing, or when the agent notices it has contradicted itself or gone in circles and needs a disciplined way to recover. Distinct from `gm-continue`: that skill is the post-`gm`-COMPLETE remaining-work check; this skill is the general drift-recovery discipline `gm-continue` invokes when a `gm` walk repeats the same gap -- not a substitute for its check.
license: MIT
compatibility: Designed for Claude Code. No external services, embedding models, or network access required for the core discipline.
metadata:
  origin: adapted-from-onestardao-wfgy
  provenance: independent-honest-reimplementation-not-verbatim
---

# WFGY method

WFGY (Wan Fa Gui Yi, "all methods return to one") is a reasoning-drift-control technique from `onestardao/WFGY`. This skill ports its genuinely portable behavioral core to a text-generating agent's own multi-step work. It does **not** reproduce the original project's TXT-OS prompt file, its hardcoded demo-benchmark output, or its user-skepticism-deflection script -- see `references/honesty-and-provenance.md` for exactly what was kept, what was dropped, and why.

The original names four "Big Bang" modules (BBMC, BBPF, BBCR, BBAM) plus a numeric drift score, deltaS = 1 - cos(I, G) (I = current state, G = goal/anchor), and a trend classifier over consecutive deltaS values (convergent/recursive/divergent/chaotic). All of this is ported below. Where the original relies on real computation this skill cannot perform (real embeddings for deltaS, real attention-weight statistics for BBAM), the instruction explicitly hands that judgment to you, the calling agent, to make in plain language instead -- see `references/wfgy-core-mechanism.md` for the full technical basis of every claim in this file, and `references/honesty-and-provenance.md` for exactly what was reframed and why.

**On deltaS**: absent a real embedding call, any numeric deltaS you produce is your own qualitative estimate, not a measurement. Use the label ("deltaS is climbing," "deltaS looks high here") as shorthand for "this step is drifting from the stated goal" -- never present a specific decimal (e.g. "deltaS = 0.42") as if it were computed, because it is not, unless real embeddings are actually available (see below).

**If a gm-plugkit spool is running in this project** (check `.gm/exec-spool/.status.json`) **AND its build serves a `similarity` verb**, you can get a real deltaS instead of a self-estimate: dispatch `{"text_a": "<G>", "text_b": "<current state>"}` and read back `{"similarity", "distance"}` -- `distance` is a genuine `1 - cos(I, G)` from real BGE-small-en-v1.5 embeddings. Do NOT assume the verb exists just because a spool is running: not every build serves it, and an unrecognized verb is silently left queued with no response rather than erroring, so a missing response after a normal read cycle means the verb is NOT available -- treat that exactly like no spool. When you get a real distance back, use it as deltaS and say so explicitly ("deltaS = 0.31, computed"). Otherwise fall back to the qualitative label above and say so explicitly too ("deltaS looks high here, my own estimate, no embedding tool available"). Never let the reader assume one when you did the other.

## G - the anchor (BBMC pattern: compare state against goal)

At the start of any task this skill applies to, write one sentence stating the actual goal (G) -- not the first sub-task, the actual end state the user wants. Re-read it before any step that could plausibly have drifted: a long tool-call chain, a pivot in approach, a request to "also" do something adjacent.

- [ ] Stated G in one sentence before starting.
- [ ] Before each major step, ask: does what I'm about to do still serve G, or have I started solving a different, adjacent problem?
- [ ] If drift is real (not just "this step looks different from the last one" -- actual scope change, contradicted earlier decision, answering a different question than asked), say so explicitly and re-anchor before continuing.

Gotcha: the temptation is to silently keep going once you notice drift, because stopping to say "wait, I've drifted" feels like an interruption. Don't suppress it -- a silently-corrected drift is invisible to the user and looks like it never happened; a stated one is a real signal they can act on.

## BBPF pattern - consider more than one path before committing

Applies to decisions with real alternatives, not every trivial step. The original's gate condition (a candidate path proceeds only if it measurably reduces deltaS and stays within a stability bound) translates to: when a decision is ambiguous or high-stakes, generate more than one real candidate approach, then commit to whichever one most clearly and verifiably advances G -- not the first idea, not the most familiar one.

- [ ] Is this decision ambiguous or high-stakes enough to warrant comparing options? (Most steps are not -- do not apply this to routine, unambiguous work.)
- [ ] If yes: name at least two real candidate approaches before picking one.
- [ ] State which one you picked and why it advances G more clearly than the alternative(s).
- [ ] If no candidate is clearly better, that is itself a signal worth surfacing to the user rather than picking arbitrarily and moving on.

## BBCR pattern - checkpoint, bounded retry, then surface rather than confabulate

The original's collapse-and-retry loop resets to a last-known-good state on detected instability, retries a bounded number of times (its own reference implementation defaults to 3), and gives up cleanly rather than looping forever.

- [ ] Before a risky or exploratory step (one that could leave things in a worse state than before), note what "last known good" looks like right now, in enough detail to actually get back to it.
- [ ] If you notice real incoherence -- repeated self-contradiction, circular reasoning, a mistake you catch yourself making -- stop, return to the last checkpoint, and retry.
- [ ] Retry at most 2-3 times for the same unresolved tension. After that, stop retrying silently.
- [ ] Surface the specific unresolved problem to the user explicitly -- state what you tried, why each attempt didn't resolve it, and what you need from them -- rather than picking an answer anyway and moving on as if it were resolved.

Gotcha: "bounded" is load-bearing. An agent that keeps trying indefinitely without ever surfacing the struggle is worse than one that fails fast and asks -- the original's own design treats "give up and report" as a real, intended exit path, not a failure of the technique.

## BBAM pattern - notice and correct over-narrow focus (agent-delegated: no real attention weights are read)

The original computes `logits * exp(-gamma * sigma(logits))` -- rescaling an actual attention/logit distribution by its own variance, flattening it when it's too peaked. A text-generating agent cannot read its own attention weights or logits; there is no real signal here for this skill to compute. Instead of dropping this module, the intelligence work is handed to you directly: periodically ask yourself whether your recent output has narrowed onto one aspect of a broader task and stayed there past the point of usefulness (repeating the same point, elaborating one sub-detail while leaving the rest of the task untouched, treating one hypothesis as settled without checking alternatives). If so, deliberately widen back out -- this is you doing, in plain judgment, what the original technique's math does mechanically to a real attention distribution.

- [ ] Periodically (not every step) ask: has my recent output been unusually narrow or repetitive relative to the task's actual breadth?
- [ ] If yes: name what got left unexamined, and deliberately address it before continuing down the narrow path.

## Trend classifier - is drift getting better or worse over the whole task

The original tracks the step-to-step change in deltaS plus a rolling average over the last several steps, and labels the trajectory:

- **convergent** -- drift shrinking, each step measurably closer to G than the last.
- **recursive** -- drift roughly flat, oscillating in a narrow band without real progress or real regression.
- **divergent** -- drift growing, with some back-and-forth (not a clean slide, but net movement away from G).
- **chaotic** -- drift growing sharply, or the goal itself has become internally inconsistent (two things you've stated as true now contradict).

This is a judgment the calling agent makes about its own trajectory across a task, not a computed statistic. Apply it at natural checkpoints (after a major milestone, before a significant pivot, when asked directly "how is this going") rather than every single step: state which of the four labels best fits the last several steps, and if the answer is divergent or chaotic, that is itself the trigger to apply the BBCR checkpoint-and-retry discipline above rather than continuing forward.

## Named failure modes to watch for

`references/failure-modes.md` adapts a broader set of specific failure patterns from WFGY's own problem taxonomy (hallucination from ungrounded claims, context drift over a long task, entropy collapse into rambling/repetition, logic collapse at a reasoning dead end, symbolic/abstract-reasoning collapse, memory/persona incoherence, multi-agent contradiction) into checklist items scoped to general agent work. Read it once per project (or whenever a failure feels like it matches one of these named shapes) -- it is more specific and example-driven than the compressed disciplines above.

## Recording durable lessons (the self-learning surface)

This is this project's own addition on top of the adapted WFGY pattern, not part of the original technique -- see `references/honesty-and-provenance.md` for why that distinction matters.

The moment a bounded-retry cycle above resolves (whether it succeeded or had to surface to the user), or the moment you catch a concrete, non-obvious mistake anywhere in the task, append an entry to `<project-root>/.wfgy/lessons.md` (create the file and its parent directory if they don't exist yet) before finishing the turn. Use this exact shape, matching the style in `references/lessons-template.md`:

```
## <date> -- <one-line summary>
Goal (G): <what you were actually trying to accomplish>
What drifted / what went wrong: <specific, concrete>
Fix / resolution: <specific, concrete>
Generalizes to: <what future work in this project should watch for because of this>
```

Read `.wfgy/lessons.md` at the start of a new task in this project, if it exists, before applying the disciplines above -- a lesson already recorded here is exactly the kind of drift this skill exists to catch earlier next time.

## What this skill is not

It does not compute real embeddings, real cosine similarity, or real attention-weight statistics -- every place the original relies on that computation, this skill hands the equivalent judgment to you, the calling agent, explicitly (see the deltaS note above, and the BBAM section). It does not reproduce the original TXT-OS file's scripted demo output or its skepticism-deflection behavior -- those are named and explicitly rejected in `references/honesty-and-provenance.md`. It is not a site-maintenance or project-specific tool; it carries no assumptions about what project it's applied in.
