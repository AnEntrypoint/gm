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
  "runner_update_poll_interval_secs": 600
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

Changing `heartbeat_interval_secs` requires a daemon restart to take effect (read once
at startup, not re-read per tick, since these govern the daemon's own loop timing).
