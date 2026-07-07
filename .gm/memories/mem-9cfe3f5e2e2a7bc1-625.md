---
key: mem-9cfe3f5e2e2a7bc1-625
ns: default
created: 1781867430803
updated: 1781867655193
---

CASCADE REPOS INVOLVED (2026-06-19): AnEntrypoint/{rs-exec, rs-codeinsight, rs-search, rs-plugkit, rs-learn, gm} -- push to any triggers cascade. rs-plugkit Cargo.toml is the version source-of-truth; gm.json holds plugkitVersion. Per-repo roles: rs-exec (JS execution host), rs-codeinsight (code indexer), rs-search (vector search), rs-plugkit (orchestrator + wasm cdylib), rs-learn (learning/recall), gm (harness + npm publish). The only admissible remote refs are main and gh-pages. cascade.yml -> release.yml -> plugkit.wasm -> auto-bump gm.json -> publish.yml ships gm-skill + gm-plugkit + plugkit-wasm + SKILL.md mirror.
