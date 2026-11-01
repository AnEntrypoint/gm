# gm-new design directions

This note turns the evidence in `research/deep-research.md` into design directions. Each direction is marked as confirmed by the evidence, or as a hypothesis gm-new must test on its own workload before it becomes a design rule.

## Decided

- Scope: a fresh worker that replaces gm's loop, not a fork of gm. Reason: one worker, one log and one loop is the simplest design the evidence supports.
- Language: Node.js 20+ ES modules, standard library only, zero dependencies. Reason: runs unchanged on macOS, Windows and Linux, on x64 and arm, with no build step.
- Shape: gm-new is an MCP server (stdio, JSON-RPC written by hand with Node built-ins, no network listener) plus a skill at `skills/gm-new/SKILL.md`. The Claude Code session is the model. The CLI is a thin wrapper for scripted witnesses. Reason: owner decision, relayed by the gm agent (2026-11-01). It supersedes the earlier single-CLI shape, because the host model is already the worker.
- Model: in MCP mode the host model is the worker. The CLI wrapper keeps the `reply(prompt)` adapters: `scripted` (offline, deterministic) and `anthropic` (Messages API via fetch). Reason: scripted gives a free end-to-end check, and anthropic serves the CLI witnesses.
- Anthropic model: default `claude-sonnet-5-5`, overridable with `GMNEW_MODEL`; the key comes only from `ANTHROPIC_API_KEY` and the run refuses without it. Reason: the key stays out of files, logs and shell children. Spend is approved with no limit (owner, relayed by the gm agent, 2026-11-01). Live runs use the Claude Code login, because `ANTHROPIC_API_KEY` is unset here.
- Context: no summarisation. `next_context` returns the rules, the task, the witness requirement, the last 20 events and `prefixSha`; `query_log` reaches older events. Reason: the log stays complete, so no lossy summary can drop a fact.
- Governance: `rules.md` in the run directory is re-read at every step, placed first in the prompt and never compacted. Reason: rules that a summary drops are violated (finding 3).
- Tools (MCP): `next_context`, `read_file`, `write_file`, `list_dir`, `run_shell` (60 s default timeout), `job_start` (detached shell job), `job_status` (state, exit code and output tail, with a bounded `waitMs` poll), `query_log`, `finish` (needs a witness). The server writes every event to the log, and the host model calls `next_context` each step. The server answers concurrent requests: it reads stdin without blocking and replies by JSON-RPC id, so the host's parallel tool calls run in parallel and the server measures them. Reason: owner decision (2026-11-01). Each tool is one plannable step (finding 4), and background jobs let shell work overlap other actions (item 2).
- Background jobs keep state in `runs/<id>/jobs/<job>.json` (written by rename) and output in `<job>.out`. A job still running at run end is killed and awaited, and its end is logged as a `job` event. Reason: status is readable by any process, and no child outlives the run.
- Path confinement covers the file tools only: `read_file`, `write_file` and `list_dir`. Paths stay inside the workspace, a `..` segment is refused, and a symlink that leaves the workspace is refused, including a dangling one (checked with `lstat` in `nearestExisting`). Refusals are logged as `refusal` events and not thrown. `run_shell` is not confined, and doctor says so. Known limit: a shell command can create a hard link to a file outside the workspace, and the path checks do not see it. A path check does not close this, because a shell can do anything the user can. Reason: an escape attempt through the file tools shows up in the log, and path checks cannot confine a shell (gm agent, 2026-11-01).
- Loop: plan, act, observe, repeat. Each reply is one JSON action or an array of actions; actions that touch no common path run together in one wave with `Promise.all`, and a shell command, `query_log`, `finish` or unknown tool runs alone. Every reply, action and result is appended to the log with monotonic times. Stops on `finish` or at `maxSteps` (default 50). An unparseable reply counts as one step. Reason: work item 1 needs multi-action replies, and the wave rule keeps the log replayable.
- Wave planning uses real paths, not lexical ones. An existing path uses `realpath`; a new file uses the `realpath` of its parent plus its basename. Existing files are grouped by dev and ino, so hard links serialise. Writes that share a group go in one serial wave. Reason: a symlink alias or hard link to a file written in the same reply would race under `Promise.all` (found by the item 5 witness).
- Storage: `runs/<run-id>/` holds `log.jsonl` (append-only), `rules.md` and `task.json`, and `runs/` is git-ignored. Reason: runtime state is never tracked.
- Remote: `AnEntrypoint/gm-new`, branch `main`, pushed by the single writer after each committed item. Reason: the standing owner instruction says to push AnEntrypoint work, and the owner asked for this repository (2026-11-01). The repository stays private; making it public is the owner's decision.
- Doctor: the last run is the newest run directory by name, because names are timestamps. Its outcome comes from `end.status`, or else from a `finish` result. Node is checked by parsed major version (20 or newer). Its output says that the Node-below-20 failure path has no live run, and that `run_shell` is unconfined. Reason: the gm agent accepted these (2026-11-01), so doctor reports what it cannot check.
- Interactive witnesses: an interactive Claude Code session is driven in tmux through `/workspace/airc` (ccbridge), with OAuth login and no API key. ccbridge forbids `-p`, `--bare`, `--api-key` and `--settings`, so the session authenticates as a person does. A witness runs in a temp project under `/tmp` whose `.mcp.json` launches gm-new's server by absolute path, so gm-new writes nothing into its own repo. The server must work on that route, where a trust prompt on first load is expected. airc is not changed by gm-new, and its untracked files are not committed or deleted. Reason: the gm agent's decision (2026-11-01), which keeps spend on the owner's login.
- Orphans: a background job and a foreground shell command run in their own process group (detached spawn). A job kill and the run end kill the group: `kill(-pid)` on POSIX, `taskkill /T /F` on Windows. Reason: no child outlives the run, and a kill that reaches only `sh` breaks that rule (run-C left an orphaned `sleep`). Owner decision, relayed by the gm agent (2026-11-01).
- MCP queue: MCP mode queues calls by real path, with the same realpath and dev:ino grouping as wave planning. Two calls that touch one file, with at least one write, run in order. A shell call runs alone. Reads of distinct paths may run together. Reason: a host burst can write one file twice, which is silent data loss, and option (b), accepting the race, would leave that case known. Owner decision (2026-11-01).
- Queue cap: `--max-inflight` defaults to 8, and calls beyond the cap wait FIFO. Reason: the cap bounds the server's work, and the witness needs it to be deterministic. Owner decision (2026-11-01).
- Steps: each `next_context` call is one step. The run summary reports `contextCalls` with the same value. The harness uses wall time and idleMs as its primary measures, and step count as a secondary one. Reason: one explicit definition of a step, and the primary measures are the ones concurrency changes. Owner decision (2026-11-01).
- prefixSha: one definition in both modes, the sha256 of the rendered stable prefix (rules, task, witness requirement, tool descriptions and fixed instructions, in that order). The CLI and the MCP server render it with the same function, and each passes its own tool list. Reason: one name with one definition, so the hash compares across modes. Owner decision (2026-11-01).
- Dependencies: none beyond Node built-ins. The DeepSeek Harness is in developer preview and warns of breaking changes, so gm-new does not depend on it. Reason: keeps the zero-dependency decision. Source: the DeepSeek prototype (github.com/deepseek-ai/dsh-superagent-prototype, MIT) and the Harness preview notice, as reported by the gm agent; not verified here.
- Comparison trials (item 7): each comparison arm runs at least 3 trials per task, across at least 3 tasks, and the report gives the median and the spread, not one run. Reason: a single run is noise, and the prototype's Minimal-mode gain is unmeasured on controlled tasks (same source as above).
- Retry: retry 408, 409, every 5xx (502, 503, 504 and 529 included), and network errors (ECONNRESET, timeouts) with backoff from 1 s, doubling, capped at 16 s, plus or minus 20% jitter, at most 4 retries. A 429 with `retry-after` waits that many seconds, and fails with a logged reason if the header asks for more than 60 s. A 429 without `retry-after` retries at most 2 times. Every other 4xx fails at once, logged with its error type. Each retry is an event with attempt, status, errorType and delayMs. Reason: the rules follow platform.claude.com/docs/en/api/errors (fetched 2026-11-01). A spend-cap 429 has no `retry-after` and keeps failing, so it must never loop.
- Log fields: camelCase everywhere (`errorType`, `delayMs`, `prefixSha`, `durMs`). Reason: one naming convention for the log, confirmed by the gm agent (2026-11-01).
- Cache: `prefixSha` is the sha256 of the rendered stable prefix (rules, tool list, fixed instructions), logged on every model event. The anthropic request marks the last block of that prefix with `cache_control`. `usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens` are logged when present; the scripted model reports zeros. `--dump-request` prints the exact anthropic request body and exits with no network call. Reason: a prefix that changes between steps defeats caching, and the dump shows it without spend.
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
8. **Proactive mode (future, not built).** The agent watches a repo with no task. Source: the DeepSeek prototype README (github.com/deepseek-ai/dsh-superagent-prototype), as reported by the gm agent. gm-new is task-driven, and the prototype's code does not contain the proactive designs, so there is no evidence for this here.

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
- Whether a reduced tool set matches the full set on the same tasks with the same trials (the prototype's minimal configuration, as reported by the gm agent). Open until item 7 has run.

## Owner decisions (resolved)

The three questions this section used to ask are answered in Decided: scope, runtime and language, and remote.

## Next step

The first slice runs end to end with the scripted model. Run it on one long task with the anthropic model, then measure it against the current gm on the same task before adding anything from the directions above.

## Measured

- Item 9, MCP server (scripted stdio driver, outside the repo): run-A `/tmp/gmw/wA/run-A` has replies out of order (id 4 arrives eighth), inFlight 6, and the run_shell result overlaps five other results. Run-B `/tmp/gmw/wB/run-B`: parse error -32700, method not found -32601, empty-witness finish refused. Run-C `/tmp/gmw/wC/run-C`: stdin close kills the job and ends closed. Run-F `/tmp/gmw/wF/run-F` (`--max-inflight 1`): queued calls after stdin closed are refused at seq 4, 6 and 8, the slow call finishes at seq 9, and the run ends closed at seq 10. Regression: `runs/2026-11-01-11-48-26-8dbca1` matches item 1 apart from one swap in completion order. Known gap: a shell job kill reaches only `sh`, so a grandchild can outlive the run (run-C, orphaned `sleep`).
- Item 5, dangling-link escape: before, run `2026-11-01-11-29-44-dfaa1e` created `outside/new.txt` through a dangling link. After, run `2026-11-01-11-38-33-71aa8a` has seq 4 `refusal` ("path leads through a link that does not resolve") and nothing is created outside the workspace. A read through a link to outside is refused: run `2026-11-01-11-38-25-1cfd8b`, seq 4.
- Item 5, alias and hard-link waves: alias run `2026-11-01-11-38-24-444456`, seq 4 ends at 66.045 ms and seq 6 starts at 66.188 ms, so the writes are serial. Hard link (made with fs.linkSync) run `2026-11-01-11-38-25-8bcd4c`, seq 4 ends at 57.345 and seq 6 starts at 57.472. Control, unrelated files, still overlap: run `2026-11-01-11-38-59-44050b`, seq 5 and 6, inFlight 2.
- Item 2, job start event: run `2026-11-01-11-38-25-c9c2e5`, seq 4 job start, seq 8 job end (exitCode 0), seq 9 job_status exited.
- Retry every 5xx: run `2026-11-01-11-38-33-9b8e40` (`--faults 502,503,504`), seq 2 to 4 are retry events with delayMs 1194, 2100 and 4781, and seq 5 is the reply. A 4xx other than 408 and 409 fails at once: run `2026-11-01-11-38-41-436da5`, seq 2 error "not retryable: HTTP 400", no retry event.

- Item 3, retry with backoff: run `2026-11-01-11-34-59-1de3db` (scripted, `--faults 429,429`). Seq 2 and 3 are `retry` events, attempts 1 and 2, status 429, delayMs 1172 and 2209, source backoff. Seq 4 is the reply at attempts 3. Retry-after runs: `2026-11-01-11-33-17-f19f55` (delayMs 1000, source retry-after) and `2026-11-01-11-33-18-14301b` (retry-after of 90 s refused). The header parse and a live network error are not witnessed, because they need a live run.
- Item 4, prefix hash and cache: run `2026-11-01-11-35-02-40d1bf` (scripted, two steps). Seq 2 and seq 5 share `prefixSha` `f713c772...`. `--dump-request` prints the request with `cache_control` on the stable prefix block, and makes no network call.
- Item 6, doctor: `node src/cli.mjs doctor` printed Node v24.22.0 ok, ANTHROPIC_API_KEY not set, workspace writable, the last run's id, event count and outcome, and the two limits line. The Node-below-20 failure path has no live run.

- Item 1, parallel actions: run `2026-11-01-11-27-17-d7f205` (scripted). Seq 3 and 4 are two `write_file` actions in one reply (inFlight 2). Their results at seq 5 and 6 overlap: 102.121 to 108.857 and 103.942 to 109.035 ms. File actions use `fs/promises`, so their intervals can overlap in I/O, not only in logging order.
- Item 2, background jobs: run `2026-11-01-11-28-50-c49668` (scripted, `--script` replies outside the repo). Job `slow` (`sleep 3`) started at seq 3-4 (result 44.581 ms, state running). `job_status` at seq 8 showed running while `write_file` ran at seq 9 and 11-18. The `job` end event is seq 19 (durMs 3008.572, exited, code 0). The `waitMs` poll at seq 16 to 20 ran alongside `write_file` seq 17-18.
