---
key: mem-b40a5ffde1b357dd-1009
ns: default
created: 1780781403721
updated: 1780781612920
---

Audit-session self-deviation discipline (caught by audit-loop workflow iter22, 2026-06-06): the recurring gm/rs-* audit session must route ALL code/file/symbol/tooling lookup within the [gm] audit cwd through the codesearch verb (or recall for prior knowledge), NEVER native Glob/Grep. Witnessed: ccsniff --search-discipline flagged this session (7d37a7ed) for native-search-glob `**/ccsniff*` 21:25:15 + native-search-grep `ccsniff` 21:25:27 = own-session self-deviations, gate-correct. The reflex to reach for native Grep/Glob to "just locate the binary" is the exact platform-native-capability bypass the paper forbids (a plugkit verb exists -> the native tool is off-limits). Reserve native search for inspecting UNRELATED non-[gm] projects only. No PRD row warranted (behavioral discipline, no fixable tree artifact) - memorize-only corrective. This is the audit-loop workflow doing its job: it caught the auditor's own drift, which is the paper's predictability-regardless-of-LLM property turned inward.
