---
name: gm-continue
description: "Resume or check unfinished gm work when requested: reuse the checkpoint, identify actionable in-scope work, otherwise report and stop."
---

# gm-continue: resume without restarting

1. **Recover the checkpoint.** Read the original requested outcome and last compact checkpoint. Inspect current status only for files or processes that may have changed. Use task context by default; if explicitly using the runtime, read its session-owned summary and relevant PRD/mutable rows. **Done when:** completed checks, active handles and the next unanswered question are known.

2. **Classify remaining work.** Only unresolved, actionable rows within the current request are remaining work. Closed rows are history, not reasons to reopen a task. External blockers stay blocked unless new evidence makes them actionable. A new user correction changes the contract; unrelated nouns, repositories and speculative edge cases do not. **Done when:** each in-scope item is done, actionable, blocked or cancelled.

3. **Continue only actual work.** Resume an active handle without redispatching it. For actionable work, return its exact next step and evidence to the existing gm workflow; do not restart its inspection or planning phases. If the same failure recurs twice without new information, make one evidence-led diagnostic change or report a concrete blocker. Do not spawn a new skill/agent solely to restate the problem. **Done when:** the next bounded action is underway with a completion path, or no authorized action remains.

4. **Close without recursion.** If all acceptance checks are satisfied, summarize and stop on this invocation. If blocked, report the blocker and what would unblock it. Never run a confirming gm walk when nothing new was found; never require a counter file or a second empty pass to earn a final answer. Respect cancellation. **Done when:** the caller can distinguish completion, an owned active task and a blocker; there is no mandatory callback into this skill.

Adapted from AnEntrypoint/gm; copyright (c) 2026 AnEntrypoint, MIT. Pimp My Skill · SolutionsAsService · https://github.com/SolutionsAsService (adaptation credit).
