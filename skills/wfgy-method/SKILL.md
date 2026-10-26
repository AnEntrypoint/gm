---
name: wfgy-method
description: "Drift-check step, not a planner: WFGY (Wan Fa Gui Yi) drift control for multi-step agent work. Use when a task risks losing its goal over many steps, or the agent contradicts itself or goes in circles. Does not plan or decompose work (polaris-goal-compiler does that). Distinct from gm-continue, which invokes this skill when a gm walk repeats the same gap."
license: MIT
compatibility: "Designed for agent hosts. No external services, embedding models, or network access required for the core discipline."
metadata:
  origin: adapted-from-onestardao-wfgy
  provenance: independent-honest-reimplementation-not-verbatim
---

# WFGY method

WFGY (Wan Fa Gui Yi, "all methods return to one") is a reasoning-drift-control technique from `onestardao/WFGY`. This skill ports its portable behavioral core to a text-generating agent's own multi-step work. Provenance and the dropped list: `references/honesty-and-provenance.md`. Technical basis of each claim: `references/wfgy-core-mechanism.md`.

**On deltaS**: deltaS = 1 - cos(I, G) (I = current state, G = goal/anchor). Without a real embedding call (the current build serves none), every deltaS you produce is your own estimate: label it ("deltaS looks high here, my own estimate, no embedding measured") and never present a decimal as computed.

## G - the anchor (BBMC pattern: compare state against goal)

At the start of any task this skill applies to, write one sentence stating the actual goal (G) -- not the first sub-task, the actual end state the user wants. Re-read it before any step that could plausibly have drifted: a long tool-call chain, a pivot in approach, a request to "also" do something adjacent.

- [ ] Stated G in one sentence before starting.
- [ ] Before each major step, ask: does what I'm about to do still serve G, or have I started solving a different, adjacent problem?
- [ ] If drift is real (not just "this step looks different from the last one" -- actual scope change, contradicted earlier decision, answering a different question than asked), say so explicitly and re-anchor before continuing.

Gotcha: the temptation is to silently keep going once you notice drift, because stopping to say "wait, I've drifted" feels like an interruption. Don't suppress it -- a silently-corrected drift is invisible to the user and looks like it never happened; a stated one is a real signal they can act on.

## BBPF pattern - consider more than one path before committing

For ambiguous or high-stakes decisions only: name at least two real candidate approaches, commit to the one that most clearly and verifiably advances G, and surface the choice when no candidate is clearly better. Checklist and rationale: `references/bbpf-candidate-paths.md`.

## BBCR pattern - checkpoint, bounded retry, then surface rather than confabulate

Before a risky step, note the last known good state. On real incoherence, return to it and retry at most 2-3 times on that route, then switch route per Finish the work; surface the unresolved problem only when every route is blocked; never retry indefinitely. Checklist and gotcha: `references/bbcr-checkpoint-retry.md`.

## BBAM pattern - notice and correct over-narrow focus (agent-delegated: no real attention weights are read)

Periodically ask whether recent output has narrowed onto one aspect of the task and stayed there; if so, name what remains unexamined and widen back out. Details: `references/bbam-narrow-focus.md`.

## Trend classifier - is drift getting better or worse over the whole task

At natural checkpoints, label the trajectory convergent, recursive, divergent or chaotic; divergent or chaotic triggers the BBCR checkpoint-and-retry. Definitions: `references/trend-classifier.md`.

## Named failure modes to watch for

`references/failure-modes.md` lists named failure shapes with checklist items; read it once per project or when a failure matches one.

## Recording durable lessons (the self-learning surface)

When a bounded retry resolves, or a concrete non-obvious mistake is caught, append an entry to `<project-root>/.wfgy/lessons.md` before finishing the turn. Read that file at the start of a new task in the project if it exists. Entry shape and procedure: `references/lessons-template.md`.

## What this skill is not

No real embeddings, cosine similarity or attention statistics are computed here, and it carries no project-specific assumptions. Rationale: `references/honesty-and-provenance.md`.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.