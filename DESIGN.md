# gm-new design directions

This note turns the evidence in `research/deep-research.md` into design directions. Each direction is marked as confirmed by the evidence, or as a hypothesis gm-new must test on its own workload before it becomes a design rule.

## Decided

- Scope: a fresh worker that replaces gm's loop, not a fork of gm. Reason: one worker, one log and one loop is the simplest design the evidence supports.
- Language: Node.js 20+ ES modules, standard library only, zero dependencies. Reason: runs unchanged on macOS, Windows and Linux, on x64 and arm, with no build step.
- Shape: one CLI process, with no MCP server, spool, daemon or network listener. Reason: the simplest transport.
- Model: pluggable behind `reply(prompt)`, with `scripted` (offline, deterministic) and `anthropic` (Messages API via fetch). Reason: scripted gives a free end-to-end check, and anthropic is the real worker.
- Anthropic model: default `claude-sonnet-5-5`, overridable with `GMNEW_MODEL`; the key comes only from `ANTHROPIC_API_KEY` and the run refuses without it. Reason: the key stays out of files, logs and shell children.
- Context: no summarisation. Each prompt holds the rules, the task, the witness requirement and the last 20 events, plus `query_log` for older events. Reason: the log stays complete, so no lossy summary can drop a fact.
- Governance: `rules.md` in the run directory is re-read at every step, placed first in the prompt and never compacted. Reason: rules that a summary drops are violated (finding 3).
- Tools: `read_file`, `write_file`, `list_dir`, `run_shell` (60 s default timeout), `query_log`, `finish` (needs a witness). Reason: the worker's only actions, each plannable as a step (finding 4).
- Path confinement: paths stay inside the workspace, a `..` segment is refused, and a symlink that leaves the workspace is refused. Refusals are logged as `refusal` events and not thrown. Reason: an escape attempt then shows up in the log.
- Loop: plan, act, observe, repeat. Each reply is one JSON action or an array of actions; actions that touch no common path run together in one wave with `Promise.all`, and a shell command, `query_log`, `finish` or unknown tool runs alone. Every reply, action and result is appended to the log with monotonic times. Stops on `finish` or at `maxSteps` (default 50). An unparseable reply counts as one step. Reason: work item 1 needs multi-action replies, and the wave rule keeps the log replayable.
- Storage: `runs/<run-id>/` holds `log.jsonl` (append-only), `rules.md` and `task.json`, and `runs/` is git-ignored. Reason: runtime state is never tracked.
- Remote: none. No GitHub repository and no push until the owner asks. Reason: publishing is outward-facing.

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

## Concurrency evidence (digest, research/concurrency.md)

- Parallel tool calls in one turn cut wall-clock 40.6% and cost 35.9% in one self-reported study (medium, arxiv 2602.07359). Use: work item 1, measured in item 7.
- Overlapping tool execution with generation can cut latency (medium, arxiv 2603.18897, serving-system paper). Speculation can hurt under high load. Use: default off until measured.
- Fine-grained tool streaming may return invalid JSON tool input. Use: not enabled. The parser already handles unparseable replies.
- Prompt caching: order is tools, system, messages; put the breakpoint at the end of the stable prefix, before the event window. Measured 41 to 80% cost cut and 13 to 31% faster first token (medium, arxiv 2601.06007). Use: rule 5, item 4.
- Rate limits: honour retry-after first, then backoff (high, Anthropic docs). Cached input tokens do not count toward input-tokens-per-minute for most models (high). Use: rule 6, item 3.
- Dropped as unverified: cache write and read multipliers, minimum cacheable length, back-pressure measurement.

## What the evidence does not settle

- Whether a query-the-log design beats validated compaction on the same tasks (open question 2).
- Whether subagent isolation helps long-horizon outcomes (open question 4).
- Whether rule re-injection restores compliance without losing permitted actions (open question 1).

## Owner decisions (resolved)

The three questions this section used to ask are answered in Decided: scope, runtime and language, and remote.

## Next step

The first slice runs end to end with the scripted model. Run it on one long task with the anthropic model, then measure it against the current gm on the same task before adding anything from the directions above.

## Measured

- Item 1, parallel actions: run `2026-11-01-11-27-17-d7f205` (scripted). Seq 3 and 4 are two `write_file` actions in one reply (inFlight 2). Their results at seq 5 and 6 overlap: 102.121 to 108.857 and 103.942 to 109.035 ms. File actions use `fs/promises`, so their intervals can overlap in I/O, not only in logging order.
