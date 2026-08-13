# Named failure modes to watch for

`onestardao/WFGY`'s `ProblemMap/` directory names and describes 60+ specific ways multi-step reasoning and retrieval pipelines fail. Most are scoped to RAG/vectorstore pipelines and are out of scope for a general coding-agent skill. The subset below generalizes to any multi-step agent task and is worth checking against explicitly. Fetched and adapted from the real source documents (`hallucination.md`, `context-drift.md`, `entropy-collapse.md`, `logic-collapse.md`, `symbolic-collapse.md`, `memory-coherence.md`, `agent-memory-drift.md`, `multi-agent-chaos.md`) -- reworded here as plain checklist items an agent applies to its own work, not as retrieval-pipeline diagnostics.

Where the original describes a symptom detectable via embeddings or token statistics, the instruction here asks the calling agent to make the equivalent judgment call itself in plain language -- the intelligence work is delegated to the agent, not computed.

## Hallucination from irrelevant context

Original pattern: a retrieval pipeline can score a chunk as "close" by cosine similarity while it adds no real logical support to the answer. Agent-scale equivalent: before stating something as fact, check whether it's actually grounded in something you read or verified in this task, versus something that merely sounds plausible alongside what you did read. If you can't point to where a claim came from, say so rather than stating it as established.

## Context drift over a long task

Original pattern: goals fade and topics morph across a long conversation even when each individual turn looks locally correct. Agent-scale equivalent: this is the same pattern as the G-comparison in `SKILL.md`'s main discipline -- the failure mode named here is specifically "each step looked fine in isolation, but the sequence as a whole solved a different problem than the one stated." Check the whole arc, not just the latest step.

## Entropy collapse (rambling, repetition, fluent nonsense)

Original pattern: attention diffuses across a long or multi-topic prompt, producing repetition loops, topic wandering, or grammatically fine output with no real content. Agent-scale equivalent (this is the BBAM-derived judgment call from `SKILL.md`): if you notice your own output getting repetitive, vague, or padded without adding real information, that is the signal to stop and re-focus rather than continue producing more text in the same unproductive direction.

## Logic collapse (dead ends, frozen threads)

Original pattern: a reasoning chain hits a state where no next step clearly follows, and instead of recovering, the system either keeps emitting filler or restarts from scratch, losing the whole trail. Agent-scale equivalent: this is exactly what `SKILL.md`'s BBCR-pattern checkpoint/bounded-retry discipline exists to catch -- recognize the dead end explicitly, revert to the last checkpoint, and take a genuinely different approach rather than either grinding on the same dead end or throwing away useful prior work.

## Symbolic/abstract reasoning collapse

Original pattern: recursive logic, layered abstractions, or symbolic/philosophical prompts cause replies to drift, self-contradict, or dissolve into incoherent language that still reads as grammatically fluent. Agent-scale equivalent: when working through a genuinely abstract or self-referential problem (e.g. reasoning about the skill's own instructions, or a recursive algorithm), periodically test whether your current statement actually cashes out to something concrete and checkable -- if you can't restate the current claim in concrete terms, that's a signal you may have drifted into fluent-sounding but empty abstraction.

## Memory/persona coherence over a long task

Original pattern: in long-running or multi-agent contexts, facts flip, personas merge, and earlier decisions silently vanish. Agent-scale equivalent: before restating or relying on an earlier decision in a long task, check it against what was actually decided (the `.wfgy/lessons.md` file and the task's own history), rather than reconstructing it from a fuzzy recollection that may have drifted from what was actually agreed.

## Multi-agent chaos (contradicting orders, lost provenance)

Original pattern: when multiple agents (or, per this session's own gm-style workflow, multiple subagents) share a task, roles blur, one agent's output contradicts another's, and no one can tell which agent made which decision. Agent-scale equivalent: when dispatching or reading results from subagents, keep clear which agent produced which claim, and if two subagents' findings conflict, surface the conflict explicitly rather than silently picking one or blending them into an unattributed synthesis.
