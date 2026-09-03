---
key: mem-25c5dbc5dd6e36ff-536
ns: default
created: 1785410701737
updated: 1785410701737
---

Absence of file edits never authorizes skipping a browser witness in gm. browser-witness-coverage only checks files edited this turn and is vacuously satisfied by an empty edit list -- the separate app-loads-witnessed gate on DECIDE->COMPLETE closes that gap: any project with .gm/browser-config.json present must record a same-turn healthy browser dispatch regardless of edit count, or the transition refuses. A confirmation/audit turn asserting the app works is itself a claim requiring the same live witness a code-change turn needs.
