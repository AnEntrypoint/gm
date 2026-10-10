# 06 SEC — gm-git-pull-refused-dirty-tree-blocks-served-recovery

- **Secrets**: the reply echoes git's own porcelain paths and commit subject lines; no token, URL
  credential or env value enters it. The push leg runs through the same git verb surface as before, which
  never materialises a credential in a reply.
- **Injection**: `branch` comes from the dispatch body and is passed to `git_call_argv` as a typed argv
  element (`["fetch", "origin", branch]`, `["diff", ...]`), never through a shell, so a branch name cannot
  smuggle a second command. Comparison is string equality between git's own path output and git's own dirty
  list; no path is constructed from user text and no path escapes the repo.
- **Identity**: both commits are authored lanmower (`657315+lanmower@users.noreply.github.com` on GitHub,
  `lanmower@users.noreply.github.com` locally) — `git_log` `1791673513525-500-14d19b8a4ad3578a` confirms the
  rs-plugkit commit's author. No author or committer override was requested.
- **Trust boundary**: `recovery_steps` names verbs and paths only; it is an instruction to the agent, and the
  only thing it can cause is a `git_status` over git-reported paths and a `git_push` of a rev — both already
  inside the caller's own authority. Nothing in it writes outside the repo.
- **Least privilege change**: the fix removes a refusal; it grants no new capability that a clean tree did
  not already have, and it never pulls with rebase or force (`strict_fast_forward:true`, `pull_via:ff_only`
  in W-E).
