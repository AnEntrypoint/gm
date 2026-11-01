# gm-new design directions

This note turns the evidence in `research/deep-research.md` into design directions. Each direction is marked as confirmed by the evidence, or as a hypothesis gm-new must test on its own workload before it becomes a design rule.

## Decided

- Scope: a fresh worker that replaces gm's loop, not a fork of gm. Reason: one worker, one log and one loop is the simplest design the evidence supports.
- Language: Node.js 20+ ES modules, standard library only, zero dependencies. Reason: runs unchanged on macOS, Windows and Linux, on x64 and arm, with no build step.
- Shape: gm-new is an MCP server (stdio, JSON-RPC written by hand with Node built-ins, no network listener) plus a skill at `skills/gm-new/SKILL.md`. The Claude Code session is the model. The CLI is a thin wrapper for scripted witnesses. Reason: owner decision, relayed by the gm agent (2026-11-01). It supersedes the earlier single-CLI shape, because the host model is already the worker.
- Independence from gm: gm-new does not use gm. Its code, skill, MCP server, runner, tests and builds use no gm MCP tool, no gm skill, no gm runner and no gm state. gm is the comparison target for arm B only, and the arm B configuration in `tools/live.mjs` is comparison tooling. Reason: gm-new replaces gm, so it must not depend on it (the user's instruction, 2026-11-01). Earlier builder briefs that named the gm MCP for code search are superseded.
- Model: gm-new makes no API calls. In MCP mode the host session is the model. The CLI has one model, `scripted`, which is offline and deterministic. Reason: a project decision (2026-11-01), taken on the user's instruction that gm-new is an MCP tool and does not interact with any API. No API key is needed, because interactive Claude Code runs on OAuth. Anything that would call an API is reported to the gm agent to do, not done here.
- Anthropic adapter: removed. gm-new holds no API key and sends no Messages API request, so the earlier decisions (the default model, the key from `ANTHROPIC_API_KEY`, the fetch adapter) are superseded. Reason: a project decision (2026-11-01), taken on the user's instruction that gm-new is an MCP tool. Spend belongs to the host session on the Claude Code login, not to gm-new.
- Context: no summarisation. `next_context` returns the rules, the task, the witness requirement, the last 20 events and `prefixSha`; `query_log` reaches older events. Reason: the log stays complete, so no lossy summary can drop a fact.
- Governance: `rules.md` in the run directory is re-read at every step, placed first in the prompt and never compacted. Reason: rules that a summary drops are violated (finding 3).
- Tools (MCP): `next_context`, `read_file`, `write_file`, `list_dir`, `run_shell` (60 s default timeout), `job_start` (detached shell job), `job_status` (state, exit code and output tail, with a bounded `waitMs` poll), `query_log`, `finish` (needs a witness). The server writes every event to the log, and the host model calls `next_context` each step. The server answers concurrent requests: it reads stdin without blocking and replies by JSON-RPC id, so the host's parallel tool calls run in parallel and the server measures them. Reason: owner decision (2026-11-01). Each tool is one plannable step (finding 4), and background jobs let shell work overlap other actions (item 2).
- Background jobs keep state in `runs/<id>/jobs/<job>.json` (written by rename) and output in `<job>.out`. A job still running at run end is killed and awaited, and its end is logged as a `job` event. Reason: status is readable by any process, and no child outlives the run.
- Path confinement covers the file tools only: `read_file`, `write_file` and `list_dir`. Paths stay inside the workspace, a `..` segment is refused, and a symlink that leaves the workspace is refused, including a dangling one (checked with `lstat` in `nearestExisting`). Refusals are logged as `refusal` events and not thrown. `run_shell` is not confined, and doctor says so. Known limit: a shell command can create a hard link to a file outside the workspace, and the path checks do not see it. A path check does not close this, because a shell can do anything the user can. Reason: an escape attempt through the file tools shows up in the log, and path checks cannot confine a shell (gm agent, 2026-11-01).
- Loop: plan, act, observe, repeat. Each reply is one JSON action or an array of actions; actions that touch no common path run together in one wave with `Promise.all`, and a shell command, `query_log`, `finish` or unknown tool runs alone. Every reply, action and result is appended to the log with monotonic times. Stops on `finish` or at `maxSteps` (default 50). An unparseable reply counts as one step. Reason: work item 1 needs multi-action replies, and the wave rule keeps the log replayable.
- Wave planning uses real paths, not lexical ones. An existing path uses `realpath`; a new file uses the `realpath` of its parent plus its basename. Existing files are grouped by dev and ino, so hard links serialise. Writes that share a group go in one serial wave. Reason: a symlink alias or hard link to a file written in the same reply would race under `Promise.all` (found by the item 5 witness).
- Storage: `runs/<run-id>/` holds `log.jsonl` (append-only), `rules.md` and `task.json`, and `runs/` is git-ignored. Reason: runtime state is never tracked.
- Remote: `AnEntrypoint/gm-new`, branch `main`, pushed by the single writer after each committed item. Reason: the standing owner instruction says to push AnEntrypoint work, and the owner asked for this repository (2026-11-01). The repository stays private; making it public is the owner's decision.
- Doctor: the last run is the newest run directory by name, because names are timestamps. Its outcome comes from `end.status`, or else from a `finish` result. Node is checked by parsed major version (20 or newer). Its output says that the Node-below-20 failure path has no live run, that `run_shell` is unconfined, and that the process-group kill is unverified on Windows. Reason: the gm agent accepted these (2026-11-01), so doctor reports what it cannot check.
- Interactive witnesses: an interactive Claude Code session is driven in tmux through `/workspace/airc` (ccbridge), with OAuth login and no API key. ccbridge forbids `-p`, `--bare`, `--api-key` and `--settings`, so the session authenticates as a person does. A witness runs in a temp project under `/tmp` whose `.mcp.json` launches gm-new's server by absolute path, so gm-new writes nothing into its own repo. The server must work on that route, where a trust prompt on first load is expected. airc is not changed by gm-new, and its untracked files are not committed or deleted. Reason: the gm agent's decision (2026-11-01), which keeps spend on the owner's login.
- Orphans: a background job and a foreground shell command run in their own process group (detached spawn). A job kill, a foreground timeout and the run end kill the group: `kill(-pid)` on POSIX, `taskkill /T /F` on Windows. An interrupt (SIGINT or SIGTERM) on the CLI kills every group at once with SIGKILL, then exits, so no new call starts while the process goes down.
- Next context: `next_context` never waits behind a path call or a running shell. It reads the rules and takes a snapshot of the log at call time, which is safe because the log is append-only. Reason: a host should not lose a step's context for the length of a shell. Owner decision via the gm agent (2026-11-01). Witness: `/tmp/gmnc/keep/run`. The next_context reply (seq 4) comes before the 3 s run_shell result (seq 5), at 206 ms against 3129 ms.
- Foreground rule: after a foreground shell call returns, its process group is SIGKILLed, so no child outlives the call. Background work goes through `job_start`, or in the CLI `run_shell` with `background` true and a job name. The rule is in the run_shell tool description. Reason: no child outlives the run, and a grandchild that outlives its foreground call breaks that rule. Owner decision via the gm agent (2026-11-01). Witness: run `2026-11-01-12-02-53-e4e69d`, where `sleep 47 &` was gone when the call returned.
- Windows: the process-group kill (`taskkill /T /F`) is unverified, and doctor says so. Do not claim Windows support until a Windows witness exists. Reason: this machine is Linux. Owner decision via the gm agent (2026-11-01). Reason: no child outlives the run, and a kill that reaches only `sh` breaks that rule (run-C left an orphaned `sleep`). Owner decision, relayed by the gm agent (2026-11-01).
- MCP queue: MCP mode queues calls by real path, with the same realpath and dev:ino grouping as wave planning. Two calls that touch one file, with at least one write, run in order. A shell call runs alone. Reads of distinct paths may run together. Reason: a host burst can write one file twice, which is silent data loss, and option (b), accepting the race, would leave that case known. Owner decision (2026-11-01).
- Queue cap: `--max-inflight` defaults to 8, and calls beyond the cap wait FIFO. Reason: the cap bounds the server's work, and the witness needs it to be deterministic. Owner decision (2026-11-01).
- Steps: each `next_context` call is one step. The run summary reports `contextCalls` with the same value. The harness uses wall time and idleMs as its primary measures, and step count as a secondary one. Reason: one explicit definition of a step, and the primary measures are the ones concurrency changes. Owner decision (2026-11-01).
- prefixSha: one definition in both modes, the sha256 of the rendered stable prefix (rules, task, witness requirement, the tool list with names, descriptions and input schemas, and fixed instructions, in that order). Both modes render the tool list with `renderTools` and hash the same way, since the API caches tools with their schemas ahead of the system text, so the schemas are part of the stable prefix. The CLI value changed once: `f713c772...` (run `2026-11-01-11-35-02-40d1bf`) to `676623b5...` (run `2026-11-01-12-02-34-c35d97`). The MCP value is `60254465...` (run `/tmp/gmnc/keep/run`), after the run_shell description gained the foreground rule. Reason: one name with one definition, so the hash compares across modes. Owner decision (2026-11-01).
- Dependencies: none beyond Node built-ins. The DeepSeek Harness is in developer preview and warns of breaking changes, so gm-new does not depend on it. Reason: keeps the zero-dependency decision. Source: the DeepSeek prototype (github.com/deepseek-ai/dsh-superagent-prototype): MIT, per the raw LICENSE file and the GitHub license API; not on npm, since package.json has private: true. The Harness developer-preview warning is from the product page and the repo. Checked against the primary sources in research run wf_261fe87f-4c6.
- Comparison trials (item 7): each comparison arm runs at least 3 trials per task, across at least 3 tasks, and the report gives the median and the spread, not one run. Reason: a single run is noise, and the prototype's Minimal-mode gain is unmeasured on controlled tasks (same source as above).
- Live concurrency: 1 Claude Code session at a time, across both arms, and one batch at a time (`tools/live.mjs` enforces the cap and a lock, and refuses a higher `--concurrency`). The cap was 3 and the gm agent lowered it to 1 on 2026-11-01, when the batch was stopped. Reason: the machine is saturated (the agentplug runner uses about 7 cores and 2 GB, the MCP servers total 5.1 GB, and each live session runs its own MCP chain), and the 1-minute load average was 8 to 10. The cap rises back to 3 only after the runner's concurrency cap is committed and the 1-minute load average is under 6. Trial results from before the change stay valid, since the cap changes no measurement. The original reason still applies: the OAuth rate limits are unknown, and a limit hit mid-trial would corrupt the timing. Owner decision via the gm agent (2026-11-01).
- Live metrics: every live trial is graded by its checker in `tasks/<task>/` and measured by one parser, `tools/transcript.mjs`, for both arms. Wall time runs from the prompt record to the first end_turn. Tool time is the union of tool_use to tool_result intervals. Model time is the union of gaps from each request (the prompt or a tool_result) to the next assistant record. Idle time is the wall time covered by neither. Reason: both arms are measured by the same code, from the transcript timestamps, not from our own clocks. Owner decision via the gm agent (2026-11-01).
- Live validity and load: an invalid trial is a trial whose session never became ready, or whose transcript never held its prompt. Invalid trials are listed, never dropped silently, and the report counts them. A slot is re-run once after the batch, and if it still fails it is recorded as invalid, so arm A has only two valid t3 trials, and the 3-trial rule is not claimed for t3. The 1-minute load average is recorded at the start and end of every trial. Trials that started at a load of 6 or more are reported apart from quiet-window trials, and trials from before the load was recorded apart from both. The arms are compared only on quiet-window trials, or the comparison is stated as loaded. Development builders wait until the load is under 6, and the live batch stays at one session. Reason: load changes wall time and idle time, so work running now would contaminate the timings. Owner decision via the gm agent (2026-11-01).
- Minimal tool set: the comparison of the full and reduced tool sets runs only after the runner's concurrency cap is in and the load is under 6. It does not run under load, and it does not run at all while the runner fix is blocked. It stays an open question until then. Owner decision via the gm agent (2026-11-01).
- Retry, exercised only by scripted faults in gm-new, since gm-new makes no request: retry 408, 409, every 5xx (502, 503, 504 and 529 included), and network errors (ECONNRESET, timeouts) with backoff from 1 s, doubling, capped at 16 s, plus or minus 20% jitter, at most 4 retries. Live retries belong to the host. A 429 with `retry-after` waits that many seconds, and fails with a logged reason if the header asks for more than 60 s. A 429 without `retry-after` retries at most 2 times. Every other 4xx fails at once, logged with its error type. Each retry is an event with attempt, status, errorType and delayMs. Reason: the rules follow platform.claude.com/docs/en/api/errors (fetched 2026-11-01). A spend-cap 429 has no `retry-after` and keeps failing, so it must never loop.
- Log fields: camelCase everywhere (`errorType`, `delayMs`, `prefixSha`, `durMs`). Reason: one naming convention for the log, confirmed by the gm agent (2026-11-01).
- Cache: `prefixSha` is the sha256 of the rendered stable prefix (rules, tool list, fixed instructions), logged on every model event. It is a local check that the prefix does not change between steps. gm-new sends no request, so it places no cache breakpoint: the host manages the cache. The host transcript carries each turn's `usage`, including `cache_creation_input_tokens` and `cache_read_input_tokens`. The `cache_control` marking and `--dump-request` are removed, superseded by the project decision of 2026-11-01. Reason: a prefix that changes between steps defeats caching, and the prefix hash shows it does not.
- Run summary: at run end the loop writes one `summary` event with maxInFlight, meanInFlight, modelMs, toolMs and idleMs (time with no action and no model call in flight). `query_log` reads it. Reason: concurrency and waiting are measured from the log, not estimated.
- Harness: runs a scripted task with the parallel and background features on and off, and prints each run's wall time and idleMs from its log. No paid calls. Reason: direction 6 requires measured numbers before any feature is default-on beyond items 1 and 2.
- Defaults: background jobs (`--no-background` turns them off) and parallel waves (`--serial` turns them off) are on. Speculative overlap of the next model call (rule 3) and multi-worker fan-out stay off until measured. Reason: owner decision through the gm agent; measured evidence is the only route to change them.

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
8. **Proactive mode (future, not built).** The agent watches a repo with no task. Source: the DeepSeek prototype README (github.com/deepseek-ai/dsh-superagent-prototype), checked against the primary sources in research run wf_261fe87f-4c6. It describes a proactive coding agent for one repository, and the article's designs for it are unimplemented. gm-new is task-driven, so this is a future direction with no evidence here.
9. **Verification-gated admission (future, not built).** If gm-new learns from its runs, an item is admitted only after a check, and the gaps the check did not cover are recorded, not hidden. Source: arXiv 2609.02749 (Repo-To-Skill, AREX-Skill): "no skill admitted on sources alone; surviving gaps are recorded, not hidden." The gains there are self-reported, from one preprint with no replication, and the construction compute is excluded.
10. **Matched-budget falsifier (future, not built).** Once a learned artifact exists, compare it with and without the artifact, with the same model, the same budget and the same tasks, at least 3 trials per task. Count the construction cost inside the budget. The source paper (arXiv 2609.02749) leaves construction cost out, which inflates its gains.
11. **Raw-replay arm (future).** When there is something to replay, add an arm that replays the raw log instead of a distilled skill. SkillEvolBench (arXiv 2605.24117) finds raw replay often beats distilled skills. The full log already keeps the raw trajectory (direction 1).

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
- Whether a reduced tool set matches the full set on the same tasks with the same trials (the prototype's minimal configuration, as reported by the gm agent). Open. Cost: about 18 more live trials across both arms, 3 tasks with 3 trials each, under the same load rule. Trigger: a decision that depends on whether the tool set can shrink. Not run: the gm agent closed the project without it (2026-11-01).
- Whether learned-skill gains transfer to troubleshooting work. Unmeasured, so any transfer is an experiment, not a gain.

## Owner decisions (resolved)

The three questions this section used to ask are answered in Decided: scope, runtime and language, and remote.

## Next step

Feature work is stopped. The gm agent's mandate (2026-11-01): gm-new is a complete replacement for gm and must not depend on gm. No code changes until the gm agent sends the phase plan from its inventory of gm's verbs. The live comparison is closed (see "Project close"). Still open and recorded: the minimal tool set (not run), and G3 (cache effect), now measured as a cache share, with no saving claimed.

## Research consolidation

The status of each research item, as of 2026-11-01. "Implemented" means built. "Measured" means a run in this repo shows an effect. "Witnessed" means a run shows the mechanism works. Each row cites its limit.

| Item | Status | Limit |
| --- | --- | --- |
| Background jobs (item 2) | implemented, measured: scripted median 3175 ms on, 5296 ms off | none beyond the scripted model |
| Live harness and summaries (item 7) | implemented; the scripted harness measured; the live trials partly measured | arm A has two valid t3 trials, one short of three; the trial rule is recorded as not met |
| Parallel waves (item 1) | implemented and witnessed (overlap in run 2026-11-01-11-27-17-d7f205); effect not measured | writes are too short to show a gain (42.6 ms on, 27.6 ms off) |
| Retry (item 3) | implemented, scripted witness | the live network error and the live retry-after header are not witnessed |
| Prefix hash (item 4) | implemented | gm-new sends no request; the host manages the cache, and its transcript reports cache usage |
| Queryable log (F1) | implemented, not measured | none; every event is logged and query_log reads it |
| Rules re-read each step (F3) | implemented, violation rate not tested | rules.md is re-read each CLI step and on each next_context call |
| Context as a worker action (F4) | implemented in part | query_log only |
| Validated compaction (F2) | deferred | the log is complete, so no summary exists |
| RL summariser (F5) | deferred | needs training infrastructure |
| Saturation threshold (F7) | deferred | the threshold is unverified |
| Subagent isolation | open | |
| Proactive mode, verification-gated admission, matched-budget falsifier, raw-replay arm (directions 8 to 11) | deferred | no learned artifact exists yet |
| Minimal tool set | open | cost and trigger under open questions |

Gaps the research says to close:

- G1, overlap of the next model call with tool work (C2): built. A CLI-only `--overlap` flag, default off. It is witnessed in scripted runs, and it has no live run. MCP cannot overlap, because the host owns the loop.
- G2, parallel gain (C1): built and measured with simulated latency. `--latency-ms N` is scripted only, and every event it touches carries `simulatedMs`. The numbers below are simulated, not live.
- G3, cache effect (C3): measured by the gm agent as a cache share from the host transcripts, not as a saving. Arm A is about 91% and arm B about 83% (medians, quiet trials). No saving is claimed, because the price multipliers are unverified here. See "Measured".

Limit, kept for safety: `run_shell` always runs alone. Parallel waves cover `read_file`, `write_file`, `list_dir` and `job_status`. `job_start` is a barrier as well, because it starts a shell. The shell barrier stays.

## Live comparison, closed

Valid trials only. Invalid trials are listed and counted, never dropped. Load is the 1-minute average at each trial's start: quiet means under 6, loaded means 6 or more, and unrecorded means the trial ran before load was recorded. Report: `node tools/live.mjs --report true`, written to `runs/live/report-A.json` and `report-B.json`. Medians, with spread as min to max.

Arm A (gm-new): 10 valid trials, all unrecorded, so arm A has no quiet trial.

- t1 (5 valid): wall 24948 ms (22887 to 25779), idle 675 ms, tool calls 7 (gm-new MCP 6).
- t2 (3 valid): wall 31975 ms (26788 to 35133), idle 1397 ms, tool calls 10 (MCP 9).
- t3 (2 valid): wall 25758 ms (25670 to 25845), idle 1046 ms, tool calls 10 (MCP 9). One valid t3 trial is missing, so the 3-trial rule is not met for t3. Slot t3-2 has three invalid attempts and no valid run.
- Invalid arm A records: 9. Six were superseded by a valid run of the same slot (t1-1, t1-2, t2-1, t2-2, t3-1, t3-3). Three are the attempts at slot t3-2, which has no valid run.

Arm B (gm): 9 valid trials, 7 quiet and 2 unrecorded, and no loaded trial.

- Quiet, t1 (1 trial): wall 31093 ms, idle 1463 ms, tool calls 3 (gm MCP 2).
- Quiet, t2 (3 trials): wall 48995 ms (47362 to 55716), idle 3387 ms, tool calls 6 (MCP 4).
- Quiet, t3 (3 trials): wall 53406 ms (36970 to 83288), idle 4482 ms, tool calls 8 (MCP 6). One trial, `B-t3-1-e2d32c`, used one gm MCP call out of six tool calls, so the arm B task-3 numbers mix two tool choices.
- Unrecorded, t1 (2 trials): wall 33693 ms (25104 to 42282), idle 2028 ms, tool calls 3.5 (MCP 2.5).
- Invalid arm B records: 2 (`B-t1-1-47ac20` and `B-t1-1-4cd9f4`). Both failed before the unknown-command resend was added, and no prompt reached the transcript.

Comparison: arm A has no quiet trial, and arm B's quiet trials cannot be set against arm A's unrecorded ones. So the arms are not compared, and no medians are read as a difference between gm-new and gm. The numbers above describe each arm's own trials. The tool-call split shows that each arm used its own MCP tools, but in different proportions per task.

Handoff, delivered to the gm agent, and receipt confirmed. (1) G3, the cache effect, was measured by the gm agent from the host transcripts, read-only; the result is in "Measured", with no saving claimed. (2) The minimal tool set was not run and is not requested. It stays open, and it falls under the load rule.

Still open: the minimal tool set (open question). The gaps G1 and G2 are built from the research consolidation. G3 is measured as a cache share, and no saving is claimed.

## Live comparison, quiet batch

The quiet batch ran at cap 1, one attempt per trial, with the pause rule above a 1-minute load of 6. Load was recorded at each trial's start and end. Quiet means the start load was under 6. Each task was held to 3 valid quiet trials per arm. Medians, with spread as min to max, are from valid quiet trials only.

Arm A (gm-new), 9 valid quiet trials, 3 per task, all passed:

- t1: wall 21384 ms (17890 to 36762), idle 1378 ms, tool calls 7 (gm-new MCP 6).
- t2: wall 33097 ms (28166 to 42082), idle 1991 ms, tool calls 12 (MCP 11).
- t3: wall 26036 ms (25788 to 49736), idle 482 ms, tool calls 10 (MCP 9). The first t3 trial of the batch was the t3-2 re-attempt, and it was valid.

Arm B (gm), 9 valid quiet trials, 3 per task, all passed:

- t1: wall 31093 ms (29339 to 36576), idle 1463 ms, tool calls 3 (gm MCP 2).
- t2: wall 48995 ms (47362 to 55716), idle 3387 ms, tool calls 6 (MCP 4).
- t3: wall 53406 ms (36970 to 83288), idle 4482 ms, tool calls 8 (MCP 6). One trial used one MCP call out of six tool calls.

Loaded trials: none for either arm.

Unrecorded trials, not used in the comparison: arm A has 10 valid, and arm B has 2 valid (t1), all run before load was recorded.

Invalid trials, listed and not dropped: arm A has 9 records, all readiness failures. Six were superseded by a valid run of the same slot, and three are the failed attempts at slot t3-2, which the quiet batch later filled with a valid trial. Arm B has 2 records, both from before the unknown-command resend was added.

Comparison, on quiet trials only, with 9 against 9 trials: arm A's median wall time is lower on all three tasks, and its median idle time is lower on t2 and t3. The spreads overlap on t1, and the arms differ in tool strategy as well as in harness: arm B's skill is the served prompt, while arm A's is copied in. With 3 trials per task, these are medians, not significance tests.

## Project close

The project closes with this section. Each close condition is met, and each open item is named.

Close conditions:

- The consolidated research matrix is in this file, in "Research consolidation".
- G1 (`--overlap`) and G2 (`--latency-ms`, simulated) are built and witnessed. G2 is labelled simulated wherever it appears.
- G3 (cache effect) is measured as a cache share, from the gm agent's read-only run. No saving is claimed, because the price multipliers are unverified.
- The live report is in: the final comparison, on the MCP prompt route, is below.

Final live comparison, MCP prompt route, the same route and rules for both arms. Each arm has 9 valid quiet trials, 3 per task, all passing. Medians, with spread as min to max, are from quiet trials only. The witness `A-t1-1-c49976` is excluded.

- Arm A (gm-new), t1: wall 28506 ms (17027 to 42533), idle 410 ms, tool calls 7 (gm-new MCP 6).
- Arm A (gm-new), t2: wall 34941 ms (31023 to 40033), idle 1349 ms, tool calls 12 (MCP 11).
- Arm A (gm-new), t3: wall 28077 ms (26823 to 28775), idle 803 ms, tool calls 11 (MCP 10).
- Arm B (gm), t1: wall 31093 ms (29339 to 36576), idle 1463 ms, tool calls 3 (gm MCP 2).
- Arm B (gm), t2: wall 48995 ms (47362 to 55716), idle 3387 ms, tool calls 6 (MCP 4).
- Arm B (gm), t3: wall 53406 ms (36970 to 83288), idle 4482 ms, tool calls 8 (MCP 6).

Loaded trials: none for either arm on this route. Unrecorded trials, not used: arm B has 2 (t1). Invalid records are listed in `runs/live/report-A.json` and `report-B.json`, and they are not dropped. Arm A's t3 slot t3-2 has no valid run on the copied-skill route, and it has three invalid attempts there.

The comparison: arm A's median wall time is lower on all three tasks. On t2 and t3 the spreads do not overlap. On t1 they overlap. Arm A's median idle time is lower on each task. The two arms do not use the same tools in the same way: arm A made 6 to 11 MCP calls per trial, and arm B made 2 to 6. So the difference reflects each route's tool use as well as its speed. The two arms also use different MCP servers, so this is a comparison of the two whole routes, not of one design choice.

The copied-skill record (arm A, 9 quiet trials) is kept as a labelled record. It is not pooled with the MCP route, and it is not used in the comparison above.

Open items, recorded and not run:

- The minimal tool set (open question). Its cost and trigger are above.
- G3, the cache effect, is measured as a cache share from the host transcript, and no saving is claimed (see "Measured").
- Subagent isolation, proactive mode, verification-gated admission, the matched-budget falsifier, the raw-replay arm, and the RL summariser are deferred, as the matrix says.

## Dependencies on gm, to be replaced

Recorded on 2026-11-01 under the gm agent's mandate that gm-new must not depend on gm. Each entry is a dependency to be replaced. No new dependency is added. The phase plan from the gm agent's inventory will assign each one.

- `.gitignore`, lines 1 to 60: a `# >>> plugkit managed` block, written by gm's plugkit tooling, listing gm's state paths. Replace with an ignore list gm-new owns.
- `.gm/` at the repo root: about 2.4 MB of gm runner state, untracked and written by gm's tooling in this repo. Replace by removing it once the plan allows; gm-new's own runtime state is `runs/`.
- Not yet removed, and ignored as a stopgap: the untracked .gm/ directory at the repo root, about 2.4 MB of gm runner state. A snapshot of the whole directory was taken first: "/tmp/gm-new-gm-state-20261101-200445" (3.1 MB). It holds gm config and prose caches, gm.db (empty vector tables), gm exec-spool files (prd and mutable dispatches, not gm-new rows), and status files. No gm-new row, receipt or witness is in it. The live gm runner (pid 1561623) rewrites it as a heartbeat into every project it serves, so removal is undone while it runs. gm has filed this as a defect. The directory and its ignore entry come out with the replacement.
- Not committed, and ignored as a stopgap: .agentplug-kv/ at the repo root, gm runtime state. Its ignore entry comes out with the replacement.
- `tools/live.mjs`: the arm B configuration (`/config/.gm-tools/gm-mcp-server.mjs` and the `/mcp__gm__gm` prompt), and the cleanup of `.gm` and `.agentplug` after each trial. Comparison tooling only, and the only code that names gm's paths. The plan decides whether the comparison stays, as an external measurement, or leaves this repo.
- Build process: builder briefs and this session's code search used gm's MCP `gm.codesearch`. Superseded, and no gm-new file depends on it, but the process did run through gm.
- Coordination: decisions were relayed by the gm agent, a peer session, over messages. That is process, not product, and the phase plan replaces it.
- Recorded results: `runs/live/B-*` and `report-B.json` are arm B's (gm's) trials. They are a comparison record, not a dependency of gm-new.
- Not a dependency: the MCP server name `gm-new`, the `gm-new` skill, and the research notes that cite gm's evidence.

## Measured

- G3, cache effect, measured by the gm agent (read-only over runs/live, no new trials, no load added). Per turn, the cache share is cache_read / (input + cache_creation + cache_read), deduplicated by uuid, with medians over valid, non-witness trials that finished:
  - Arm A, copied-skill route: 18 valid trials (9 quiet), median 90.7%, min 87.7%, max 93.2%, pooled 91.0%.
  - Arm A, mcp-prompt route: 9 valid trials, all quiet, median 91.4%, min 89.9%, max 94.4%, pooled 92.1%.
  - Arm B, mcp-prompt route: 11 valid trials (9 quiet), median 82.3%, min 78.1%, max 93.4%, pooled 84.5%; quiet only 82.7%.
  - These are shares of input served from cache, not savings. A saving needs the cache price multipliers, which are unverified here, so no saving is claimed.
  - The routes differ in tool use and in how the skill is delivered, so this is not a controlled comparison.
  - Unreconciled: the copied-skill count is 18 here, against 19 in the report. One trial is not reconciled.
- Arm A MCP-route re-run, pause: paused at 2026-11-01 18:58:34 SAST, with a 1-minute load of 7.53, which is above the pause rule of 6. The runner and its server were stopped, and no trial was in flight. Completed MCP-route quiet trials so far: task 1 has 3 (`A-t1-q1-0708b9`, `A-t1-q2-9816f5`, `A-t1-q3-2c477b`), and task 2 has 1 (`A-t2-q1-10a3a1`). Five slots remain, two for t2 and three for t3, and the batch resumes when the 1-minute load is under 6. The witness `A-t1-1-c49976` is excluded from the counts.

- CLI prefixSha change, query_log kinds (gm agent decision, 2026-11-01). The CLI prompt listed the event kinds without retry, job, pending or summary, and the agent sees all four. The description now lists them. Old prefixSha `676623b5...` (run `2026-11-01-12-02-34-c35d97`, reconfirmed in `2026-11-01-16-35-08-af599d`). New prefixSha `dfb09f4f...` (run `2026-11-01-16-35-16-d87f6d`). Reason: the prompt must describe the events the agent actually sees. The MCP prefixSha does not change, because the MCP prompt uses the MCP tool list.
- MCP-route witness (gm agent decision, 2026-11-01): run `A-t1-1-c49976`, route mcp-prompt, witness true, load 7.43 to 7.49, so loaded and counted in no group. The transcript (`runs/live/A-t1-1-c49976/transcript.jsonl`) shows the first user record as command-name `/mcp__gm-new__gm-new` with the task in its arguments, and the second as the skill body through MCP (a text block that starts "# gm-new loop"). "Base directory for this skill" and ".claude/skills" are absent. The checker passed, with 7 tool calls, 6 of them gm-new MCP. Its next_context prefixSha is `5f84be1a...`, computed with that run's task text, so the MCP prefixSha depends on the task as well as the tool list.

- G2, simulated latency 500 ms (`node src/bench.mjs --task slow-writes --latency-ms 500`, scripted, four independent writes then a finish, 3 trials per arm). SIMULATED, not live. Parallel waves on: median wall 2010.9 ms (2008.9 to 2014.9), median idle 3.6 ms, runs `2026-11-01-15-19-35-886d17`, `-37-6ff901`, `-39-f67de4`. Waves off (`--serial`): median wall 3512.7 ms (3512.1 to 3537), median idle 3.5 ms, runs `2026-11-01-15-19-42-08c888`, `-45-07250e`, `-49-a14119`.
- G1, overlap witness (scripted, latency 500 ms, two writes then a read of a.txt, then finish; SIMULATED latency). With `--overlap`, run `2026-11-01-15-20-01-5d098a`: pending is seq 5, the second reply is seq 6, the write results are seq 7 and 8, the read is seq 9, wall 2054 ms. Without it, run `2026-11-01-15-20-03-243227`: the write results are seq 5 and 6, the second reply is seq 7, wall 3055 ms. Across three runs each, wall medians are 2010 ms with overlap and 3012 ms without. Edge runs, all with overlap: HTTP 400 `2026-11-01-15-21-45-b46985`, parse error `2026-11-01-15-21-46-f31ba3`, max steps `2026-11-01-15-21-48-ca5309`.
- Regression, default flags: run `2026-11-01-15-19-28-bf7078` against the pre-change baseline `2026-11-01-15-16-26-c4deda` gives the same 23 events, apart from timing fields.
- Live pause, second: the arm B resume was paused again at 2026-11-01 16:18:48 SAST, with a 1-minute load of 15.68, which the gm agent's rule requires (pause above 6). The runner, its server and the trial in flight (`B-t3-2`, no result) were stopped. Two arm B slots remain, `t3-2` and `t3-3`. The resume is `node tools/live.mjs --arm B --tasks t1,t2,t3 --trials 3 --concurrency 1 --resume true`, once the gm agent reports load under 6.
- Arm B quiet-window trials recorded so far (start load under 6): `B-t1-3-1d05b6` (start 3.61), `B-t2-1-0e9f91` (2.56), `B-t2-2-b8815f` (3.03), `B-t2-3-0157fd` (3.24), `B-t3-1-e2d32c` (5.38). Each passed its checker. `B-t2-3-0157fd` ended at load 5.38, and `B-t3-1-e2d32c` started at 5.38, so both are close to the threshold.

- Live pause: the arm B batch was paused at 2026-11-01 15:59:23 SAST, with a 1-minute load of 11.88 at the pause (11.20 as the batch stopped), on the gm agent's decision, because load of 6 or more yields only loaded trials. The runner, its server and the trial in flight (`B-t1-3-82b605`, which had no result) were stopped. Its state is the result files: `--resume true` reruns exactly the slots without a valid result, so the resume picks up the same trials. The cap stays at 1. The minimal-tool comparison does not run. A-t3-2 stays invalid, as recorded.
- Live trials so far, not yet compared: arm A has 10 valid trials and arm B has 2 valid trials, all recorded before load was recorded, so they are unrecorded. Invalid trials are listed in the report, never dropped (`node tools/live.mjs --report true`).

- Item 7, scripted harness (`node src/bench.mjs`, 4 arms times 3 tasks times 3 trials, scripted model, real tools, all 36 runs finished). Rerun output is in `/tmp/gmnc/bench-rerun.txt`, and the builder's run ids are between `2026-11-01-12-10-30-293006` and `2026-11-01-12-11-22-db192c` in `runs/`. Median wall time, background task: 3175 ms with background on, against 5296 ms with it off. The 3 s job overlaps the 2 s command only when background is on. Parallel on and off give 42.6 and 27.6 ms on the writes task, which is too short to show a parallel gain. The scripted replies return at once, so idle time does not separate the arms.
- Summary event witnesses: CLI run `2026-11-01-12-09-42-d52be8` (summary seq 22, end seq 23; maxInFlight 2, idleMs 35.77, contextCalls 6). MCP run `2026-11-01-12-09-59-68794c` (summary seq 13, end seq 14; contextCalls 2, idleMs 134.494). Interrupt run `2026-11-01-12-10-21-51dbf6` (summary seq 4, end seq 5, status interrupted).

- Item 11, interactive witness (ccbridge, tmux, OAuth, no API key, PATH shim adds `--mcp-config` and `--strict-mcp-config`, temp project under `/tmp`). Transcript: `/config/.claude/projects/-tmp-gmw-airc-6VCAmM/354ecddb-8950-4a35-a0d3-0e5d7a1429e3.jsonl` (copy in `/tmp/gmnc/item11/transcript.jsonl`). Run log: `/tmp/gmnc/item11/run/log.jsonl`, run id `run` (the basename of the `--run-dir`). Turn 1 (`next_context`): `u:mcp__gm-new__next_context`, then the result with stepsLeft 49, the reply, and `e:`; log seq 3 and 4. Turn 2 (`/gm-new`): the skill's base-directory line, then next_context (seq 5 and 6), write_file (7 and 8), read_file (9 and 10), finish with witness "gm-new witness" (11 and 12), and end finished (13), then `e:`. The trust prompt was accepted for the temp folder only. Teardown: `/exit` sent, tmux session gone, server stopped, temp project removed, and no `--mcp-config` process left.
- Item 10, skill: `/gm-new` loaded `skills/gm-new/SKILL.md` in the item 11 session, and that turn finished a run (above). Item 10's witness is this turn.
- Friction, item 11: Claude Code probes `server/discover` at start. The server answers -32601 and logs an `error` event (seq 2). Harmless, but it adds log noise. Open for a decision.

- Orphans and queue (scripted, outside the repo under /tmp/gmc/runs): the process-group kill (A1f, A2f) ends the `sleep 60` grandchild on stdin close and on a foreground timeout. The MCP queue (B1, B2, B3) serialises same-file writes, overlaps distinct reads, and holds a shell until reads return. Same-file pairs include an alias and a hard link. Prefix hash: the MCP next_context returns one prefixSha for two calls (C1), and the CLI hash for the item 4 input is unchanged (C2, run `2026-11-01-11-57-12-eecfce`).
- Interrupt: run `2026-11-01-12-00-30-28c01f` (scripted). A background job (`sleep 61` in its group) and a foreground `sleep 31` were running when SIGINT arrived. The CLI exited 100 ms later, no sleep survived, and seq 8 is `end` with status interrupted and signal SIGINT. Regression: run `2026-11-01-12-00-56-fb40c9` finished after 2 steps.

- Item 9, MCP server (scripted stdio driver, outside the repo): run-A `/tmp/gmw/wA/run-A` has replies out of order (id 4 arrives eighth), inFlight 6, and the run_shell result overlaps five other results. Run-B `/tmp/gmw/wB/run-B`: parse error -32700, method not found -32601, empty-witness finish refused. Run-C `/tmp/gmw/wC/run-C`: stdin close kills the job and ends closed. Run-F `/tmp/gmw/wF/run-F` (`--max-inflight 1`): queued calls after stdin closed are refused at seq 4, 6 and 8, the slow call finishes at seq 9, and the run ends closed at seq 10. Regression: `runs/2026-11-01-11-48-26-8dbca1` matches item 1 apart from one swap in completion order. Known gap: a shell job kill reaches only `sh`, so a grandchild can outlive the run (run-C, orphaned `sleep`).
- Item 5, dangling-link escape: before, run `2026-11-01-11-29-44-dfaa1e` created `outside/new.txt` through a dangling link. After, run `2026-11-01-11-38-33-71aa8a` has seq 4 `refusal` ("path leads through a link that does not resolve") and nothing is created outside the workspace. A read through a link to outside is refused: run `2026-11-01-11-38-25-1cfd8b`, seq 4.
- Item 5, alias and hard-link waves: alias run `2026-11-01-11-38-24-444456`, seq 4 ends at 66.045 ms and seq 6 starts at 66.188 ms, so the writes are serial. Hard link (made with fs.linkSync) run `2026-11-01-11-38-25-8bcd4c`, seq 4 ends at 57.345 and seq 6 starts at 57.472. Control, unrelated files, still overlap: run `2026-11-01-11-38-59-44050b`, seq 5 and 6, inFlight 2.
- Item 2, job start event: run `2026-11-01-11-38-25-c9c2e5`, seq 4 job start, seq 8 job end (exitCode 0), seq 9 job_status exited.
- Retry every 5xx: run `2026-11-01-11-38-33-9b8e40` (`--faults 502,503,504`), seq 2 to 4 are retry events with delayMs 1194, 2100 and 4781, and seq 5 is the reply. A 4xx other than 408 and 409 fails at once: run `2026-11-01-11-38-41-436da5`, seq 2 error "not retryable: HTTP 400", no retry event.

- Item 3, retry with backoff: run `2026-11-01-11-34-59-1de3db` (scripted, `--faults 429,429`). Seq 2 and 3 are `retry` events, attempts 1 and 2, status 429, delayMs 1172 and 2209, source backoff. Seq 4 is the reply at attempts 3. Retry-after runs: `2026-11-01-11-33-17-f19f55` (delayMs 1000, source retry-after) and `2026-11-01-11-33-18-14301b` (retry-after of 90 s refused). The header parse and a live network error are not witnessed, because they need a live run.
- Item 4, prefix hash and cache: run `2026-11-01-11-35-02-40d1bf` (scripted, two steps). Seq 2 and seq 5 share `prefixSha` `f713c772...`. Superseded: `--dump-request` and the `cache_control` marking are removed, since gm-new sends no request.
- Item 6, doctor: `node src/cli.mjs doctor` printed Node v24.22.0 ok, ANTHROPIC_API_KEY not set (that line is removed now), workspace writable, the last run's id, event count and outcome, and the two limits line. The Node-below-20 failure path has no live run.

- Item 1, parallel actions: run `2026-11-01-11-27-17-d7f205` (scripted). Seq 3 and 4 are two `write_file` actions in one reply (inFlight 2). Their results at seq 5 and 6 overlap: 102.121 to 108.857 and 103.942 to 109.035 ms. File actions use `fs/promises`, so their intervals can overlap in I/O, not only in logging order.
- Item 2, background jobs: run `2026-11-01-11-28-50-c49668` (scripted, `--script` replies outside the repo). Job `slow` (`sleep 3`) started at seq 3-4 (result 44.581 ms, state running). `job_status` at seq 8 showed running while `write_file` ran at seq 9 and 11-18. The `job` end event is seq 19 (durMs 3008.572, exited, code 0). The `waitMs` poll at seq 16 to 20 ran alongside `write_file` seq 17-18.
