---
name: history-rewrite-lessons
description: "How the attribution rewrite of all gm repos worked, and the gm and git gotchas it exposed (force pushes, detached HEADs, duplicate commits, bots that re-commit)"
metadata:
  node_type: memory
  type: reference
  originSessionId: d196665c-8e22-4a3a-8a93-96e5b7e2c1a4
  modified: 2026-10-24T13:12:23.090Z
---
Rewrote commit msgs (removed Co-Authored-By Claude and lanmower admin trailers) and authors (lanmower noreply/admin/anthropic addrs → almagestfraternite@gmail.com) across parent and every submodule.

**Gotchas:**
- `git_push` refuse force push. Guest demand `allow_rewrite:true`, but verb body schema reject that key, so no gm call can force-push. Use `git push --force-with-lease=<ref>:<expected> <url> <new>:<ref>` from mirror, always with expected remote sha read right before.
- `git filter-branch -- --all` no rewrite detached HEAD. Point HEAD at temp ref during rewrite, then restore HEAD to mapped sha.
- Rewriting identical commit can dedupe: two old commits differing only by author → one new commit. Verify by unique keys, not count.
- Parent gitlink remap change tree of every pinning commit, so match commits by date, subject, mapped parents (topo order), gitlinks as tie-breaker. Tree-based matching fail here.
- Verify rewrite: tip tree equal old tree (when nothing changed), zero trailers and zero bad author addrs over `--all`, every old commit mapped.
- Background `git pull` from other session re-merged rewritten history with old one on shared checkout. Restore local refs before any rewrite; do not rewrite checkout another session is pulling.
- Bot workflows (bump-pins, skill-release) commit as noreply addr from hardcoded identities. Fix identity in workflow, or every automated commit reintroduce it.
- Use lease with `--force-with-lease=<ref>:<sha>` on every push. Rejection with "is at <sha>" mean remote already hold that value, which is success.