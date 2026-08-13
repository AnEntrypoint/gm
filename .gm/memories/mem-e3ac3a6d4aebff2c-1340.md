---
key: mem-e3ac3a6d4aebff2c-1340
ns: default
created: 1785430318353
updated: 1785430318353
---

rs-plugkit config.rs load_implicit_default_repo_tier / load_repo_tier transient-fetch-failure rationale: a transient refresh failure (offline, a concurrent process holding the repo's git lock, a momentary network blip) must not discard an already-materialized cache from a prior successful refresh -- that cache is real, present-on-disk config a project explicitly opted into, not nothing. Falling through to a lower tier on every transient blip silently swaps a project's configured FSM graph/prose mid-session: a phase persisted under the cached graph stops being valid in whatever tier resolution fell back to, and every subsequent transition denies with 'no edge from X to Y' against a graph the project never actually serves stably. Live-witnessed 2026-07-30 (thebird project, gm-plugkit runtime): turn-state.json showed phase:PLAN (compiled-default's state) even though the cached gm.config.json on disk had a valid fsm.graph pointer the whole time -- fetcher.refresh was failing intermittently and the code was discarding the good cache on every failure instead of reading it. Fix: read whatever is cached before giving up; only a genuinely empty/never-populated cache degrades a repo-backed tier to Rejected/Absent (explicit tiers) or Absent (the implicit-default tier, which degrades quietly since nobody explicitly opted into it).
