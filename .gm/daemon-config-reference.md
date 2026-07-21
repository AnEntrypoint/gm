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
