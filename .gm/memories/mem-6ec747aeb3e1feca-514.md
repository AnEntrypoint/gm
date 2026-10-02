---
key: mem-6ec747aeb3e1feca-514
ns: default
created: 1790670295561
updated: 1790670295561
---

## Resolved mutable: stash-index-cause

Live served git_stash then git_stash_pop in an isolated repository reproduced loss of the staged layer: state.txt returned as worktree-only (index=base, worktree=unstaged). Source git_stash_pop called `git stash pop <ref>` without `--index`. The local repair now calls `git stash pop --index <ref>`; an isolated Git round-trip using that exact argv restored MM with index=staged and worktree=unstaged. Rust/WASM rebuild remains unavailable because cargo/rustfmt are absent.
