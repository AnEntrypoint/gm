# Update propagation

Each row = current behaviour of one update path. Sources read at pins: gm-mcp `89ddc7da`, agentplug `f46be1a6`, rs-plugkit `206105cb`, skills manifest on gm main. Read from upstream, not local agentplug checkout.

Bytes = body bytes, from code or blob size. Header bytes not measured.

| Component | Check | Interval | Bytes per unchanged check | Gap row |
| --- | --- | --- | --- | --- |
| gm-mcp | Probe commits API for gm-mcp main head w/ stored `If-None-Match` validator. New head sha → fetch `gm-mcp/bin/gm-mcp-server.js` at that commit. Code: `gm-mcp/src/self-update.js`, `probeHead`, lines 266-283. | 60 s (`DEFAULT_CHECK_INTERVAL_MS`, line 17 of `gm-mcp/src/self-update.js`). `GM_MCP_SELF_UPDATE_INTERVAL_MS` overrides. | 0 body bytes on 304. | `gm-mcp-identity-guard`, `gm-mcp-stale-edge-update` |
| skills | Retired. Skills are served over MCP (prompt `/mcp__gm__<name>`, resource `skill://<name>`); the runner writes no host skill root, so there is no refresh cycle. | none | none | retired (`skill-link-freshness`) |
| gm-config | Remote ref probe `global_remote_tip` in `rs-plugkit/crates/plugkit-core/src/config_sync.rs`, line 326. Probe runs only when caller reaches that fn. `probe_decision`, lines 169-203, skips probe while last one inside interval; result recorded under lock. | Measured `change_interval_ms` if exists, else 60 s (`UNMEASURED_REF_INTERVAL_MS`, line 20 of `rs-plugkit/crates/plugkit-core/src/config_sync.rs`). After failed probe, backoff doubles from 60 s, stops at 1 h (`PROBE_BACKOFF_MAX_MS`, line 24). | Unmeasured. | `gm-config-probe-cadence` |
| runner | Runner update poll. Latest release tag compared w/ running version; swap needs strictly greater release. Code: `agentplug/crates/agentplug-runner/src/download.rs`, lines 1362-1371. | 60 s default (`runner_update_poll_interval`, lines 438-440 of `agentplug/crates/agentplug-runner/src/daemon.rs`). | Unmeasured. | `runner-version-guard` |
| plugins | Per plugin, `probe_latest_plugin_release` reads sidecar `<asset>.wasm.sha256` from github.com release redirect: first hop read w/o following, then Location read. Plain requests, no validator. Code: `agentplug/crates/agentplug-runner/src/download.rs`, lines 1534-1564. | `plugin_update_poll_interval_secs`, default 60 s (lines 426-428 of `agentplug/crates/agentplug-runner/src/daemon.rs`). Daemon config file it writes when absent sets 600 s (lines 360-368). Per-plugin overrides by name, lines 429-437. | Two requests per plugin per poll. First hop's body not read. Sidecar is one SHA-256 line; exact size unmeasured. | `plugin-conditional-probe` |

## Notes

- gm-mcp: at this pin probe on commits API, not raw edge. `gm-mcp-stale-edge-update` asks for that change; its live witness still open. Guard, `versionGuardReason` in `gm-mcp/src/self-update.js`, compares version text and bytes, not build identity (`gm-mcp-identity-guard`).
- gm-config: row text says 1 h unmeasured interval. Pinned source sets 60 s at line 20; 1 h is backoff ceiling at line 24.
- plugins: effective interval on fresh install = 600 s written to daemon config file, not 60 s compiled default.