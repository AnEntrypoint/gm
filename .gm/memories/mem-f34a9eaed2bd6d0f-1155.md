---
key: mem-f34a9eaed2bd6d0f-1155
ns: default
created: 1784224020897
updated: 1784224020897
---

gm-plugkit cli.js spool command: when the calling CLI/terminal appears to hang or block during a version-drift or wrapper-drift watcher reboot, the cause is the cold path unconditionally awaiting ensureReady() (probeSelfStaleness + resolveLatestRemoteVersion + possible wasm download) before spawning the daemon, even though a local wasm+wrapper already exist and isReady() is a synchronous fs.existsSync check. Fixed by short-circuiting to an immediate startSpoolDaemon() spawn whenever isReady() && wrapper-on-disk, deferring the network freshness check to a detached background child process (spawnBackgroundFreshnessCheck) -- the watcher self-heals on a bad wasm load and polls for updates every 600s once running, so pre-verifying freshness synchronously before spawning is redundant work on the CLI's hot path. General lesson: any CLI-entry cold path that awaits network-freshness checks before doing the actually-requested action (spawn/boot/serve) should ask whether the freshness check can move to a background/async surface instead of blocking the caller -- the daemon's own self-heal + periodic poll usually already covers eventual convergence.
