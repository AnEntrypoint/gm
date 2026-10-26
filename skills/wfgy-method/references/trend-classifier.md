# Trend classifier

## Trend classifier - is drift getting better or worse over the whole task

The original tracks the step-to-step change in deltaS plus a rolling average over the last several steps, and labels the trajectory:

- **convergent** -- drift shrinking, each step measurably closer to G than the last.
- **recursive** -- drift roughly flat, oscillating in a narrow band without real progress or real regression.
- **divergent** -- drift growing, with some back-and-forth (not a clean slide, but net movement away from G).
- **chaotic** -- drift growing sharply, or the goal itself has become internally inconsistent (two things you've stated as true now contradict).

This is a judgment the calling agent makes about its own trajectory across a task, not a computed statistic. Apply it at natural checkpoints (after a major milestone, before a significant pivot, when asked directly "how is this going") rather than every single step: state which of the four labels best fits the last several steps, and if the answer is divergent or chaotic, that is itself the trigger to apply the BBCR checkpoint-and-retry discipline (`skills/wfgy-method/references/bbcr-checkpoint-retry.md`) rather than continuing forward.