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

Note: today's daemon architecture already drains one project's own pending
spool work fully sequentially (one request file at a time, single worker
thread per project per tick -- see `dispatch_project`'s own doc comment), so
a single project's `gm` dispatches never actually run concurrently against
EACH OTHER under the current loop. This cap is consequently a forward-looking
safety net against a future change to that assumption (e.g. per-project
multi-threaded draining) rather than something observable in today's
single-project timing -- it costs nothing when unconfigured and does no harm
when configured, but there is currently no code path where a single
project's own in-flight `gm` count can exceed 1 regardless of this setting.
