# gm-new design directions

This note turns the evidence in `research/deep-research.md` into design directions. Each direction is marked as confirmed by the evidence, or as a hypothesis gm-new must test on its own workload before it becomes a design rule.

## Simplicity rule

Start with one worker, one log and one loop. Add a component only when a measured run shows the current design failing. This follows the Anthropic harness guidance (low confidence, dated) and the single-agent baseline result (medium confidence).

## Directions

1. **Complete log, queried by code (hypothesis).** Every observation, action and outcome is appended to one log. Recall runs code over the log, not a summary. Evidence: finding 1 (medium). Unknown: log growth and retrieval cost. Test: the same long task run with a log-query worker and a compacting worker, with cost measured.

2. **Validated compaction, only when the log is too big to query (hypothesis).** If compaction is needed, check each summary against the next k steps before using it. Evidence: finding 2 (medium, self-reported, one replication dispute). Test: summary accepted or rejected by a judge on gm's own traces, compared against no validation.

3. **Governance rules outside the compactor (hypothesis, risk confirmed, fix untested).** Rules that must hold for the whole run are kept in a file that every step re-reads, so they cannot be summarised away. Evidence: finding 3 supports the risk (medium, observational). The Constraint Pinning remedy was refuted 0-3, so this direction is not evidence-backed. Test: a rule set of gm's kind, violation rate with and without re-injection.

4. **Context operations as worker actions (hypothesis).** Compaction and log queries are actions the worker plans, like file edits and commands. Evidence: finding 4 (medium). The 57.6% result is one run against same-family baselines, below frontier models, so it is not evidence that the design is best.

5. **Summariser trained with the worker (out of scope for now).** Finding 5 (medium) needs training infrastructure gm-new does not have. Keep it as a later option, not a day-one design.

6. **Measure one worker before fanning out (confirmed in direction, threshold unusable).** Finding 6 (medium) supports measuring a single-worker baseline before adding parallel workers. The saturation threshold (finding 7, low) must not be used as a constant (94% and 45% are unverified).

7. **Subagent isolation (open).** The claim that isolated subagents help was refuted 1-2. Parallel subagents stay in gm-new only where a measured run shows they beat one worker on the same task.

## What the evidence does not settle

- Whether a query-the-log design beats validated compaction on the same tasks (open question 2).
- Whether subagent isolation helps long-horizon outcomes (open question 4).
- Whether rule re-injection restores compliance without losing permitted actions (open question 1).

## Decisions that need an owner before building

These are not answerable from the research:

1. Scope: a fresh worker that replaces gm's loop, or a reduced fork of gm that keeps its verbs, memory and code search.
2. Runtime and language, and whether the MCP and spool transport stays.
3. Whether gm-new gets its own repository and remote. No remote exists yet, and pushing one is an outward-facing step.

## Next step

Pick the scope in decision 1. Then build the smallest worker that runs one long gm task end to end with a full log, and measure it against the current gm on the same task before adding anything from the directions above.
