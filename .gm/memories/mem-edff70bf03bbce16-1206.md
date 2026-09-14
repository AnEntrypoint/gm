---
key: mem-edff70bf03bbce16-1206
ns: default
created: 1789414786192
updated: 1789414786192
---

rs-plugkit pre-release witness without touching the shared daemon: build `cargo build -p rs-plugkit --release --target wasm32-wasip1 --features slim`, copy target/wasm32-wasip1/release/rs_plugkit.wasm to <scratch>/aphome/plugins/gm.wasm (plus libsql/treesitter/bert .wasm/.version copied from ~/.agentplug/plugins, gm.version set to a non-semver tag), then from the target project's cwd run `AGENTPLUG_HOME=<scratch>/aphome AGENTPLUG_NO_DAEMON=1 ~/.gm-tools/agentplug-runner.exe dispatch gm <verb> '<json body with session_id>'` -- one-shot local load of the fresh build, ~10s per dispatch. codesearch walk policy (rs-plugkit 0.1.1297, scan_universe.rs walk_policy): a caller-named root/path that is gitignored is walked with no .gitignore and only dependency/VCS/cache/tool/hidden dirs skipped (dist/build/out/static/vendor read); caller-named non-git target honours its own .gitignore with the same dir policy; whole-project default and git failure keep the full SKIP_DIRS list. filename mode shares list_scan_universe and resolve_scan_target. gm-config submodule checkout had no [user] block (global email is not the lanmower noreply) -- check .git/modules/<sub>/config before committing in a submodule.
