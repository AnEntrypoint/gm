---
key: mem-48d3bac005e9eece-1093
ns: default
created: 1783431026319
updated: 1783431026319
---

Chronic machine-wide watcher SILENT ABORT root cause + fix (this session): deaths presenting as exit_code=1 signal=null with no stderr, no uncaughtException fire, no shutdown-reason file are EXTERNAL taskkill /F kills, not crashes -- on Windows process.kill(pid,'SIGTERM') is already TerminateProcess. The killers were gm's own kill paths (killExistingPlugkit, killSpoolWatcherInCwd, supervisor duel, wrapper lock-takeover/peer-sweep) taskkilling pids read from stale .watcher.pid/.supervisor.pid/.status.json with zero identity verification -- Windows pid reuse turns any stale pid file into a loaded gun against unrelated current watchers. Fix: pidIsPlugkitProcess cmdline gate (Get-CimInstance Win32_Process) + .kill-attribution.json written into the victim's spool dir before every kill + skip-and-clean on mismatch, all 5 kill sites. Diagnostic path that found it: gm-log supervisor.watcher-exited-unexpectedly events carry exit_code/signal/had_shutdown_reason_file -- read those BEFORE hypothesizing OOM/wasm-trap; exit 1 + null signal + no handler output = external hard kill signature.
