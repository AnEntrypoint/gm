---
key: mem-f6ef64a3d2fe2b2d-1326
ns: default
created: 1781599503533
updated: 1781599699213
---

Audit-loop fire (2026-06-16 iter-7): clean validation fire. 3 own deviations were iter-6 self-inflicted tail (2 prd-resolve-unknown-id from resolving untrack-orphan-worktree-gitlinks BEFORE its lost prd-add landed; 1 mid-chain-stall during the workflow wait) -- all gate-positive, recovered. ROOT of the resolve-before-add: a single Bash with 11 cat-heredoc spool writes corrupts the JSON (parse-failed prd-adds, silently lost); re-doing via the Write tool succeeded. LESSONS: (1) use the Write tool (or few heredocs) for spool bodies, never a big multi-heredoc Bash; (2) ALWAYS read the prd-add out/ response (or check known_ids) before prd-resolve; (3) interleave dispatches during long waits. VALIDATED IN PRACTICE: iter-6 orphan-worktree-gitlink cleanup holds (be5417ec on origin, git ls-files .claude/worktrees empty, .claude/worktrees gitignored, tree clean); iter-5 SKILL.md dispatch-race caveat is LIVE in the served prose (this fire's ENOENT-erroring Write-tool prd-adds all dispatched = caveat correct); ccsniff 1.1.24 fast (7-disc 18.7s, 6 disciplines 0, search-discipline=1 own git-ls-files slip gate-positive); codeinsight+search flawless (recency 0.9999998, degenerate graceful); cascade 0.1.645; prior commits on origin. iter-6 follow-ups (workflow native-search, publish latency) are known/recurring, deferred.
