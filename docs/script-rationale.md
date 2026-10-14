# Script and CI rationale

Moved out of AGENTS.md to keep it under 30,000 bytes. Owner: the repo root. Each entry names the script or workflow it explains.


- `scripts/triage/check-pins.sh`: an unpublished pin breaks every fresh recursive clone, so it fetches the pinned sha into a throwaway bare repo.
- `scripts/remote-cmp.mjs`: raw paths once produced `/contents/C:/...` 404s that read as "absent"; 401 and 403 are auth or rate limit, never absence.
- `scripts/build-graph-page.mjs`: page numbers come from the graph JSON; a broken edge refuses the page before any file is written.
- `scripts/sweep-config-sync-litter.mjs`: deleting orphaned state is a cache miss, not data loss; `--max-age-days` is opt-in.
- `gm-mcp/.github/workflows/verify.yml` (workflow name `build-verify`): its name must keep "build". `bump-pins` holds the submodule pin while a release, publish, build or wasm run is non-green, so renaming the workflow silently releases the hold.
- `.github/workflows/house-clean.yml` keeps only the latest release per `-bin` repo; the installers read only that, so superseded releases have no reader.
- gm-mcp bundle drift: a running gm-mcp snapshots the bundle it booted from, and reloads only to a provably newer bundle. Handover passes the listening socket over IPC so the port is never closed.
- Reaper: child-ledger attribution is its safety gate. A process is retired only when every predicate measured true (null means unknown). Browser leases retire only on positive evidence of death, not heartbeat. The runner, http server and supervisor are detached on purpose, so they are never candidates.
- `gm-mcp/src/ports.js`: probes answer null when unmeasured, never false. Only "nothing listening" licenses retiring a port.
- Tool aliases (`rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs/git.rs`): `git_reset` takes `ref` or `rev`, and `mode` or `hard`, each pair refused together as `conflicting_fields`; `git_revert` takes `paths` or `ref`. Boolean fields in `gm-mcp/src/verb-table.js` use `booleanLike` (boolean or string), not strict `z.boolean()`.
- Install bundle host: an unreachable bundle host warns and keeps the deployed bundle (`install.sh`, `bin/gm-install.js`); it never aborts an install that already has one.
