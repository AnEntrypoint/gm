---
name: polaris-goal-compiler
description: A human-AI communication protocol layer that compiles goals into task atoms, active/blocked work, verification gates, and claim ceilings before execution. Part of WFGY 5.0 Polaris Protocol. Use before complex AI work to make it inspectable, harder to fake, and less likely to collapse into premature completion.
license: MIT
compatibility: Upstream Polaris Goal Compiler is released ChatGPT-first (teaser compatibility is ChatGPT only); portability to other assistants, coding agents, and skill systems is a stated design direction, not an officially supported target in the teaser release. This skill is a portable Claude Code adaptation of that protocol.
metadata:
  origin: onestardao-wfgy-5.0-polaris-protocol
  provenance: adapted-and-honest-reimplementation-not-verbatim
---

# Polaris Goal Compiler

A human-AI communication protocol under WFGY 5.0 Polaris Protocol.

**Compile first. Execute one active atom. Verify before unlock. Claim only what is supported.**

## What This Is

Polaris Goal Compiler adds the missing protocol layer between human requests and AI execution. Before producing work that looks finished, it turns the request into visible, inspectable structures:

- **Task atoms**: The smallest executable units
- **Active work**: What can be done now
- **Blocked work**: What must wait
- **Verification gates**: What must be checked before unlock
- **Truth objects**: What is known vs. claimed
- **Claim ceilings**: What the assistant is allowed to claim
- **Closure records**: What is done, missing, partial, or unsafe

This is not a normal prompt template. It is a portable TXT-based execution protocol for making complex AI work:
- Easier to inspect
- Harder to fake
- Less likely to collapse into premature completion

## When to Use

Use this skill **before** starting any of:
- Complex creative work (writing, design, research)
- Multi-step reasoning tasks (proofs, strategy, debugging)
- Long-horizon projects (planning, architecture, implementations)
- High-stakes decisions where correctness matters
- Work involving others (code review, collaboration)
- Theorem work or formal verification

**Do not use on**: trivial single-step tasks, reflex responses, simple lookups.

## Core Workflow

### 1. State Your Goal Clearly

Write one sentence: what do you actually want to accomplish? Not the first sub-task, the end state.

### 2. Ask: Compile My Request

Ask the AI to turn your request into:
- Task atoms (smallest units)
- Dependencies (which blocks which)
- Active vs. blocked work
- Verification gates (checks before unlock)
- Claim ceilings (what can be claimed when)

### 3. Review the Compilation

Before execution starts, verify:
- Are all task atoms actually atomic?
- Are dependencies correct?
- Are verification gates realistic?
- Will claim ceilings prevent overstatement?

### 4. Execute One Active Atom

Work on ONE task at a time. After each:
- Verify before moving to the next
- Check against claim ceiling (don't overstate readiness)
- Move blocked tasks to active only if dependencies are met

### 5. Iterate

After each atom completes, return to step 4 until all atoms are done.

## Key Concepts

### Task Atoms

The smallest executable unit that:
- Can be completed in one session
- Has clear entrance and exit criteria
- Produces something verifiable
- Does not depend on incomplete tasks

### Active vs. Blocked Work

- **Active**: Ready to start, all dependencies met
- **Blocked**: Waiting on something else to finish first

Clear separation prevents fake progress (looking busy on wrong things).

### Verification Gates

What must be checked *before* moving forward:
- Does this output match what was asked for?
- Is it complete enough for the next task?
- Are there hidden assumptions?
- What could break downstream?

### Truth Objects

What must actually become true for the work to count as done, as opposed to prose that merely reads as if it were true. A verification gate passes against a truth object, not against a well-written paragraph.

### Claim Ceilings

Honest limits on what can be claimed:
- "Complete" means verified to work end-to-end, not "looks finished"
- "Correct" means checked against requirements, not "sounds right"
- "Ready" means tested for the next stage, not "looks polished"

Over-claiming (saying something is done when it's only drafted) is the most common trap in AI work. See `references/claim-ceiling-examples.md` for concrete examples in different contexts.

### Closure Records

For each atom, record what is done, what is missing, what is only partially true, and what is still unsafe to claim. A closure record preserves continuity across rounds so that unfinished work stays visible instead of being buried in prose -- this is what stops a local step from being promoted into fake global completion.

## Interaction with Other Skills

### With WFGY-Method (Drift Control)

- **Goal Compiler** structures the work (what to do)
- **WFGY-Method** keeps you on track (why you're doing it)

Use Goal Compiler first to atomize, then apply WFGY-Method while executing each atom.

**Integration**: Goal Compiler's "verification gate" becomes a checkpoint for WFGY-Method's BBCR (bounded retry).

### With Fifth-Dimension Engine (Problem Solving)

- **Goal Compiler** specifies the problem clearly
- **Fifth-Dimension Engine** solves/structures it
- **Goal Compiler's verification gates** check the engine's output

Use Goal Compiler to compile the problem statement, then dispatch to Fifth-Dimension Engine.

**Integration**: Fifth-Dimension Engine's "route" output maps to Goal Compiler's task atoms and verification gates.

## References

See `references/` directory for:
- `task-atomization.md` -- how to break work into atoms
- `verification-gates.md` -- designing verification for each stage
- `claim-ceiling-examples.md` -- what "complete" actually means in different contexts
- `skills/polaris-protocol/SKILL.md` -- the Polaris Protocol tree root and state machine that wires this skill to Fifth-Dimension Engine and WFGY-Method

## What This Is Not

This skill does not:
- Solve the problem (that's Fifth-Dimension Engine)
- Control drift during execution (that's WFGY-Method)
- Replace thinking (it enhances it by making structure visible)
- Guarantee success (only guard against fake completion)
- Claim to be the full WFGY 5.0 system (it is one public protocol component; the upstream engine is the main product surface)
