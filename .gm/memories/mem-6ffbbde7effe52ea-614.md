---
key: mem-6ffbbde7effe52ea-614
ns: default
created: 1786958418619
updated: 1786958418619
---

gm-method: fanned-out subagents that inherit the parent's literal SESSION_ID collide on spool (verb, session_id-N) claims across concurrent dispatches, even though each correctly session-prefixes its own <N> counter -- the daemon has no per-agent partition below session_id, only below the combined key. Fix: every subagent mints its own SESSION_ID derived from the parent's plus an index (e.g. <parent_session_id>-sub<k>), never reuses the parent's value verbatim. This is now stated in gm-config/prose/entry.md's SESSION_ID and Subagent fan-out sections (authored source, reaches every project on next debounce).
