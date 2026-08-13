---
key: mem-a7e1f53af7f5c6bb-1395
ns: default
created: 1784800909480
updated: 1784800909480
---

wasm_dispatch/verbs.rs history (rs-plugkit): lifecycle_liveness() targets a real gm-log outage incident (dead for 2+ weeks before being noticed) which was invisible because nothing watched the watcher -- gmsniff --watchers works but is pull-only, requiring someone to think to run it. Reads the LAST "evt: {json}" line from .gm/exec-spool/.watcher.log (the exact format emit_event/host_log write), parses its ts, reports age in ms -- turning a dead lifecycle-event pipe into a same-session health finding instead of a fortnight-long silent gap. LIFECYCLE_STALE_WARN_MS=30min is generous since a genuinely idle project between real dispatches is not itself evidence of a broken pipe. health() installed_release_tag() reads from the project's own gm.json rather than ~/.agentplug/plugins/gm.version: the latter is authoritative but lives outside the wasm sandbox root, unreliably readable, while gm.json is in reach and is what the cascade auto-bumps in lockstep with the published release. health()'s "version" field alone was env!(CARGO_PKG_VERSION) -- the plugkit-core CRATE version -- while gm.version/gm.json plugkitVersion track the RELEASE TAG CI auto-bumps; two different numbers in the same format invited a false comparison (a health reading appearing older than an installed tag read as stale when the wasm was in fact current) -- both are now reported, named for what each actually is.
