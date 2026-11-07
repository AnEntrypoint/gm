# CI verdict for 609b9c5

## Commit and workflow

- Commit `609b9c5ffe71540560d598c0410dfb07125b8f11` (`609b9c5`), subject `release: print the host build stamp and clean-rebuild the host targets`, author and committer lanmower, no trailers, pushed; `origin/main == HEAD`, clean tree.
- Source patch `/tmp/gm-clean-host-rebuild.patch` (1192 bytes): read-only `Host build stamp` step (Node reads CMakeCache.txt and compile_commands.json; no shell grep, no comments) and `Clean host rebuild` step `cmake --build "build/${{ matrix.preset }}" --target gm gm-core --clean-first`, both before the witness.
- release `42313288413`: `completed success`; jobs `build-windows (windows-11-arm...):success`, `build-windows (windows-latest...):success`, all six other build jobs success, `publish:success`.
- pages-build-deployment `42313287327`: `completed success`.

## Host build stamp evidence

Stamp step, arm64 job log `/tmp/gm-arm64-job.log:601-604`:

```
GMNEW_COMMIT:STRING=609b9c5
GMNEW_VERSION:STRING=609b9c5-229
C:/a/gm/gm/native/components/host/main.cpp -DGMNEW_BUILD_COMMIT=\"609b9c5\" -DGMNEW_BUILD_VERSION=\"609b9c5-229\"
C:/a/gm/gm/native/components/host/main.cpp -DGMNEW_BUILD_COMMIT=\"609b9c5\" -DGMNEW_BUILD_VERSION=\"609b9c5-229\"
```

Stamp step, x64 job log `/tmp/gm-x64-job.log:601-604` (same values, `D:/a/gm/gm/...` paths).

Clean rebuild step, both logs at lines 605-606: `cmake --build "build/arm64-windows-release" --target gm gm-core --clean-first` and `cmake --build "build/x64-windows-release" --target gm gm-core --clean-first`.

## Fresh binaries

Worker binary versions step, arm64 (`/tmp/gm-arm64-job.log:795-797`):

```
git head: 609b9c5
gm.exe: 609b9c5-229 (609b9c5) size=9844224 mtime=2026-11-06T23:43:09.104Z
gm-core.exe: 609b9c5-229 (609b9c5) size=9844224 mtime=2026-11-06T23:43:10.005Z
```

Worker binary versions step, x64 (`/tmp/gm-x64-job.log:795-797`):

```
git head: 609b9c5
gm.exe: 609b9c5-229 (609b9c5) size=7275008 mtime=2026-11-06T23:44:40.267Z
gm-core.exe: 609b9c5-229 (609b9c5) size=7275008 mtime=2026-11-06T23:44:41.836Z
```

## Windows cmd-only run_shell witness

Both jobs pass. `/tmp/gm-arm64-job.log:855-871` and `/tmp/gm-x64-job.log:855-871` print the same JSON shape:

```
"controlCommand": "echo gm-windows-cmd-witness-ok",
"cmdOnlyCommand": "dir /b",
"control": { "ok": true, "exitCode": 0, "signal": null,
  "output": "gm-windows-cmd-witness-ok\n",
  "launcher": "C:\\Program Files\\Git\\bin\\bash.exe" },
"cmdOnly": { "ok": true, "exitCode": 0, "signal": null,
  "output": "runs\r\n",
  "launcher": "cmd" }
```

No `cmd-only run_shell did not use cmd.exe` error, no GNU `dir: cannot access '/b'` output, no missing launcher field, no exit code 1; the following `Package` step started normally on both jobs.

## Root cause

The release jobs linked stale `gm.exe`/`gm-core.exe` binaries until `--clean-first` forced a fresh link of the `gm` and `gm-core` host targets. Earlier release `42305435997` (HEAD `8d50e74`) and `42310665738` (HEAD `0208a2b`) both succeeded while their Windows witnesses failed with GNU `dir` output and binaries stamped `6a23dc7-162 (6a23dc7)` with mtimes 09:07/09:08Z. The version-cache fix `0208a2b` forced CMake cache stamps from HEAD but did not change the linked binaries. After `609b9c5` the stamps, compile definitions, binary versions and witness all agree at `609b9c5`.

## Prior diagnostics

- `arm-diagnose` `42305436003`: `completed success` (`gdb-arm:success`, `asan-arm:success`).
- `arm-diagnose` `42310665626`: `completed success` (`asan-arm:success`, `gdb-arm:success`).
- `arm-diagnose` `42313288379`: `completed success` (`gdb-arm:success`, `asan-arm:success`).

## Held items and gate watch

- `/tmp/gm-stale-worker-remediation.patch` remains unapplied and is no longer needed; `git apply --check` still returns rc=0.
- `/tmp/gm-version-cache-fix.patch` was applied as `0208a2b`; local scratch configure at that HEAD stamped `0208a2b` / `0208a2b-228`, and a stale-cache configure reset to a HEAD-derived `-dev` version.
- oscraft `origin/main == HEAD == 30a42797`, clean tree; `node scripts/check-all.mjs` -> `RESULT gates=59 ok=59 failed=0 drift=0 skipped=5 strict=false`; `node scripts/check-generated-lua.mjs` -> `generated lua ok 9 banners, 8 content gates, 16 runner gates, mutation case caught`.
- gm `origin/main == HEAD == 609b9c5`, clean tree; `npm run check` exit 0; `tools/ship.sh` gate `{"gate":true,"failed":[]}`.
