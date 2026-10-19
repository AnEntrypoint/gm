# Update propagation

Each row is the current behaviour of one update path. The sources are read at these pins: gm-mcp `89ddc7da`, agentplug `f46be1a6`, rs-plugkit `206105cb`, and the skills manifest on gm main. The local agentplug checkout is empty, so these are read from upstream.

Bytes are body bytes, taken from the code or from a blob size. Header bytes are not measured.

| Component | Check | Interval | Bytes per unchanged check | Gap row |
| --- | --- | --- | --- | --- |
| gm-mcp | Probes the commits API for the gm-mcp main head with a stored `If-None-Match` validator. A new head sha fetches `gm-mcp/bin/gm-mcp-server.js` at that commit. Code: `gm-mcp/src/self-update.js`, `probeHead`, lines 266-283. | 60 s (`DEFAULT_CHECK_INTERVAL_MS`, line 17 of `gm-mcp/src/self-update.js`). `GM_MCP_SELF_UPDATE_INTERVAL_MS` overrides it. | 0 body bytes on a 304. | `gm-mcp-identity-guard`, `gm-mcp-stale-edge-update` |
| skills | Reads `skills/manifest.sha256` from gm main through raw.githubusercontent.com, then re-fetches each skill file whose digest changed. A linked install is never written. Code: `agentplug/crates/agentplug-runner/src/download.rs`, `fetch_skill_bytes`, lines 1836-1847. | 60 s (`SKILL_REFRESH_INTERVAL`, line 1830 of `agentplug/crates/agentplug-runner/src/download.rs`). | 18,287 body bytes, the size of `skills/manifest.sha256` at the audited main. The helper sends no validator, so the body transfers on every cycle. | `skill-link-freshness` |
| gm-config | Remote ref probe `global_remote_tip` in `rs-plugkit/crates/plugkit-core/src/config_sync.rs`, line 326. The probe runs only when a caller reaches that function. `probe_decision`, lines 169-203, skips the probe while the last one is inside the interval, and the result is recorded under a lock. | The measured `change_interval_ms` when one exists, else 60 s (`UNMEASURED_REF_INTERVAL_MS`, line 20 of `rs-plugkit/crates/plugkit-core/src/config_sync.rs`). After a failed probe, backoff doubles from 60 s and stops at 1 h (`PROBE_BACKOFF_MAX_MS`, line 24). | Unmeasured. | `gm-config-probe-cadence` |
| runner | Runner update poll. The latest release tag is compared with the running version, and a swap needs a strictly greater release. Code: `agentplug/crates/agentplug-runner/src/download.rs`, lines 1362-1371. | 60 s by default (`runner_update_poll_interval`, lines 438-440 of `agentplug/crates/agentplug-runner/src/daemon.rs`). | Unmeasured. | `runner-version-guard` |
| plugins | Per plugin, `probe_latest_plugin_release` reads the sidecar `<asset>.wasm.sha256` from the github.com release redirect: the first hop is read without being followed, then the Location is read. Plain requests, no validator. Code: `agentplug/crates/agentplug-runner/src/download.rs`, lines 1534-1564. | `plugin_update_poll_interval_secs`, default 60 s (lines 426-428 of `agentplug/crates/agentplug-runner/src/daemon.rs`). The daemon config file it writes when absent sets 600 s (lines 360-368). Per-plugin overrides by name, lines 429-437. | Two requests per plugin per poll. The first hop's body is not read. The sidecar is one SHA-256 line; its exact size is unmeasured. | `plugin-conditional-probe` |

## Notes

- gm-mcp: at this pin the probe is on the commits API, not the raw edge. `gm-mcp-stale-edge-update` asks for that change, and its live witness is still open. The guard, `versionGuardReason` in `gm-mcp/src/self-update.js`, compares the version text and the bytes, not a build identity (`gm-mcp-identity-guard`).
- gm-config: the row text states a 1 h unmeasured interval. The pinned source sets 60 s at line 20; 1 h is the backoff ceiling at line 24.
- plugins: the effective interval on a fresh install is the 600 s written to the daemon config file, not the 60 s compiled default.
