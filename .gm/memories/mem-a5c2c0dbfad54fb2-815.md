---
key: mem-a5c2c0dbfad54fb2-815
ns: default
created: 1785232877452
updated: 1785232877452
---

When a runner/daemon binary has TWO on-disk homes -- one for the executable staged by a launcher-edge installer, one for the executable's own runtime state (install_dir()) -- diagnosing 'stale update marker' from outside must check the RUNTIME-STATE directory the running code actually reads (confirm via the source's own install_dir()/equivalent resolver), never the launcher-staging directory by assumption. A stale/frozen state directory from a prior architecture migration (old daemon wrote there, new daemon writes elsewhere) produces perfectly plausible-looking but entirely dead artifacts (cache files, guard files, version markers) that a fresh investigation can mistake for a live bug. Always grep the actual resolver function in source for the true path before trusting a directory listing's plausibility.
