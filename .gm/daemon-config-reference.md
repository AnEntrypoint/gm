# Daemon lifecycle configuration

agentplug-runner reads `~/.agentplug/daemon-config.json` at startup for the timing
constants governing its own lifecycle. This is machine-scoped (not per-project) because
the daemon is a single shared process across every registered project -- a per-project
override would be ambiguous when multiple projects are registered.

All fields optional; a field's absence (or the whole file's absence) falls back to the
value already documented in the field descriptions below. An unconfigured machine
behaves byte-identically to before this file existed.

```json
{
  "registry_poll_interval_secs": 5,
  "heartbeat_interval_secs": 10,
  "plugin_update_poll_interval_secs": 600,
  "runner_update_poll_interval_secs": 600,
  "max_concurrent_projects": 4,
  "gm_concurrency": 4
}
```

- `registry_poll_interval_secs` (default 5) -- how often the daemon re-reads
  `daemon-registry.txt` to notice newly-registered projects.
- `heartbeat_interval_secs` (default 10) -- how often the daemon writes its
  `.status.json` heartbeat and re-checks single-instance ownership authority.
- `plugin_update_poll_interval_secs` (default 600) -- how often the daemon checks
  each loaded plugin's remote release for a newer version, only when genuinely idle.
- `runner_update_poll_interval_secs` (default 600) -- how often the daemon checks
  its own executable's remote release for a newer version, only when genuinely idle.
- `max_concurrent_projects` (default 4) -- how many project-worker threads run
  concurrently in the daemon's own dispatch loop. Each worker pulls the next
  registered root off a shared queue and may block for the duration of a slow
  exec_js/browser dispatch, so this is the real ceiling on how many projects can
  be mid-dispatch at once.
- `gm_concurrency` (default: same as `max_concurrent_projects`) -- how many
  concurrent live Stores the shared `gm` plugin instance pool holds. `gm` is
  genuinely stateless (its real state lives in each project's own `.gm/` flat
  files, never in wasm memory), so more than one live Store is always safe --
  this bounds how many worker threads can be mid-gm-call simultaneously before
  the next one queues on a pool slot. Before this field existed, gm ran as a
  single process-wide instance whose Mutex was held for the full duration of
  each dispatch, so one project's long exec_js/browser call could stall an
  unrelated project's trivial phase-status/health call behind it for the
  entire duration (live-witnessed 18-21s stall, fixed by pooling instead of
  reverting to per-project instances, which would reintroduce per-project
  state duplication for a plugin whose state is supposed to live in flat
  files). bert/treesitter/libsql are NOT pooled -- exactly one shared instance
  each, unchanged -- since bert alone costs ~133MB of resident tensors per
  instance and no live contention was ever found for the three of them.

Changing `heartbeat_interval_secs`, `max_concurrent_projects`, or `gm_concurrency`
requires a daemon restart to take effect (read once at startup, not re-read per
tick, since these govern the daemon's own loop timing and pool sizing).

## Per-project fairness cap (not machine-wide)

`gm_concurrency` above is the actual TOTAL pool size and stays strictly
machine-wide -- one shared daemon process, so no per-project override of the
real pool size is admissible (a project raising its own share would be raising
it for every other registered project too, since they all draw from the same
pool).

A registered project can still set its OWN fairness ceiling: how many of that
shared pool's slots ITS OWN dispatches may occupy concurrently, as a
self-limiting cap that can only ever lower a project's effective share, never
raise the machine total. Configured per-project, read fresh on every dispatch
(same precedent as `.gm/browser-config.json`'s `BrowserConfig::load(cwd)`),
at:

```
<project>/.gm/daemon-project-config.json
```

```json
{
  "gm_concurrency_limit": 1
}
```

- `gm_concurrency_limit` (default: unset -- unbounded from this project's own
  side, i.e. bounded only by the machine-wide `gm_concurrency` pool size) --
  the maximum number of this project's own `gm` dispatches allowed in flight
  at once. A dispatch beyond this project's own limit waits (polls a
  process-wide in-flight counter keyed by project root) for one of this same
  project's earlier dispatches to finish, BEFORE it takes a slot from the
  shared pool -- it never grants extra pool slots, it only restricts how many
  of the ones the pool already has this one project may hold simultaneously.
  Released automatically (RAII guard) when the dispatch completes or panics,
  so a crash mid-dispatch cannot wedge the project at a permanently-held
  fairness slot.

Missing file, or the field absent, is byte-identical to behavior before this
file existed -- no wait loop is entered, no shared map is touched, zero
overhead beyond one file read that fails.

Note: a single project's own `gm` dispatches CAN now run genuinely concurrent
against each other -- see `background-convert` below. This fairness cap is the
real, observable ceiling on that concurrency, not a forward-looking no-op:
once a dispatch has been background-converted, the project's remaining queued
dispatches proceed against the shared pool while the converted one is still
running, and `gm_concurrency_limit` (if configured) bounds how many of that
project's own dispatches -- background-converted or not -- may hold a pool
slot at the same time.

## `background-convert` -- agent-initiated dispatch backgrounding

Each of a project's spool requests is spawned onto its own OS thread the
moment it is claimed; the daemon's own worker normally waits for that thread
to finish (bounded-poll `is_finished()` check, ~50ms cadence) before writing
the response and moving on -- functionally identical timing to a plain
synchronous call. `background-convert` lets an agent that already dispatched
a slow verb (`exec_js`, `browser`, or any other -- the mechanism is
verb-agnostic, the daemon does not need to know what a verb does to detach
the thread running it) tell the daemon mid-flight: stop waiting on this one,
keep it running, and free the worker/tick immediately. This is agent-
initiated only -- there is no timer/threshold that backgrounds a dispatch
automatically. It is unrelated to `exec_js`'s own internal `timeoutMs`-based
subprocess backgrounding (`host_task_proc`/`task.rs`'s `spawn`/`list`/
`output`/`stop`) -- that mechanism backgrounds a subprocess the JS script
itself spawned; `background-convert` backgrounds the WASM DISPATCH CALL
itself, one layer up, regardless of verb.

Request: `in/background-convert/<N>.txt`

```json
{"verb": "exec_js", "task": "<the original request's numeric filename stem>"}
```

`task` is the same id the agent already knows from having written the
original request to `in/<verb>/<task>.txt` itself.

Response: `out/background-convert-<N>.json`

```json
{"ok": true, "converted": true, "verb": "exec_js", "task": "..."}
```

or, if no matching in-flight dispatch exists for this project (wrong verb/
task, or it already finished before this request was processed -- both read
identically, since from the caller's side "never existed" and "already done"
require the same next action: read the real response, it's either already
there or on its way):

```json
{"ok": false, "error": "already_completed", "verb": "exec_js", "task": "..."}
```

Once converted, the original dispatch keeps running to completion on its own
thread and writes its real result to the EXACT SAME path the synchronous path
would have (`out/<verb>-<task>.json` + the `.ready` sentinel) -- the calling
agent's later `Read` on that same path is unchanged ABI, it just may need to
be retried later rather than being immediately available.

Ownership model: after a background-convert, the project's OTHER queued
dispatches are not blocked behind the converted one -- they proceed through
the same `SharedPluginPool`/`GmFairnessGuard` machinery a second, genuinely
concurrent checkout for that project, bounded by the exact same
`gm_concurrency` (machine-wide pool size) and `gm_concurrency_limit`
(per-project fairness cap, see above) this file already documents. A
background-converted dispatch still counts as one held pool slot and one held
fairness-guard slot for its entire real runtime -- it is not exempt from
either cap, it only stops holding the WORKER and the daemon TICK hostage.
