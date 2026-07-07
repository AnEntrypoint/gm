---
key: mem-0fece5f86abc22f9-529
ns: default
created: 1779542382291
updated: 1779542416603
---

Iter-17 (gm e73eb8d8): caught silent-failure in iter-8 self-stale probe. Empty req.on('error') and timeout swallowed all network failures. Despite 7-version staleness (2.0.1357 vs 2.0.1364), zero events ever emitted. Fix: 3s→10s timeout, emit gm-plugkit.self-stale-probe-error on every failure path (network|timeout|http-code|parse). Also discovered npx cache was serving old gm-plugkit even with @latest — manual rm -rf ~/AppData/Local/npm-cache/_npx required. Lesson: silent error handlers in HTTPS probes are anti-pattern.
