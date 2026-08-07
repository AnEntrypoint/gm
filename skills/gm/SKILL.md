---
name: gm
description: The primary driver for every coding, refactoring, debugging, or engineering task -- used for the whole task. 
allowed-tools: Skill, Read, Write, AskUserQuestion, Bash(bun *), Bash(npx *), Bash(cat *), Bash(date *)
---

# gm

Replace questions and summaries dispatching the next verb instead, or `Skill(skill="gm-continue")` at genuine `phase=COMPLETE AND prd_pending_count=0`. There is no other exit. `instruction` dispatch returns the live phase-prose and next-step guidance; dispatch it whenever uncertain, never invent the next step from memory.

Verbs write to `.gm/exec-spool/in/<verb>/<N>.txt` as JSON; read the paired `.gm/exec-spool/out/<verb>-<N>.json` in the SAME tool-call block, never narrate before reading it. `<N>` MUST be globally unique across every concurrent session sharing this project's spool, never a bare small sequential integer -- the shared daemon keys in-flight claims and out-files by the literal `(verb, N)` pair with no per-session partition, so two sessions independently picking `1`, `2`, `3`... collide on the same in-file slot and out-file, each session silently reading the other's response. Prefix every `<N>` with your own SESSION_ID (`<session_id>-<N>`, e.g. `gm-crosstalk-check-1`) and increment your own local counter from there; this makes collision structurally impossible regardless of how many sessions target the same project concurrently. Phase/PRD/mutables state lives on disk (`.gm/exec-spool/.turn-summary.json`, `.gm/prd.yml`, `.gm/mutables.yml`) and in every response body -- never assumed from context. A `phase` mismatch between `.turn-summary.json` and a fresh `instruction` response always resolves to the fresh response.

Boot probe, one call: `cat .gm/exec-spool/.status.json 2>/dev/null; echo ---; cat .gm/exec-spool/.turn-summary.json 2>/dev/null; echo ---; date +%s%3N`. Boot/reboot: `bun x gm-plugkit@latest spool` (`npx -y gm-plugkit@latest spool` if no bun) -- fire-and-forget, does not wait for serving; write your first verb right after. Dead watcher = `.status.json` `ts` stale >5min AND no future `busy_until`: boot fresh, re-dispatch. A `busy_until` in the future licenses a bounded wait (condition-poll the out/ file, never a blind sleep); it does not license declaring the watcher dead. `dispatch_orphaned` = bare re-dispatch once `ts` is fresh again; its `sweeping_pid` field changing across repeats is a real respawn (same recovery), not a stuck loop.

Spool verbs: `codesearch`, `recall`, `fetch`, `exec_js`, `browser`, `memorize-fire`, `prd-add`/`prd-resolve`/`mutable-add`/`mutable-resolve`, `transition`, `phase-status`, the git verb family (`git_status`, `git_finalize`, `git_push`, ...). Every capability routes through its verb -- codesearch (never Grep/Glob for discovery), browser (never raw Chrome/playwright), git verbs (never raw `git` via Bash, gated `deviation.bash-git-bypass`). `git_finalize {message}` bundles add->commit->porcelain-gate->push->CI-watch in one dispatch.

`browser` body is plain-text prefixed, never CLI-flag syntax: `session new`, `session list`, `session close <id>` / `session reset <id>`, `timeout=<ms>\n<expr>`, `url=<target>\n<expr>`, `screenshot[=name]\n<expr>`, `dom=<selector>\n<expr>`, or a bare JS body. Prefixes stack top-to-bottom. Sessions persist a live Chrome process across dispatches until closed/idle-reaped. Every response includes `result.debug: {console, pageErrors, network, performance, gl}` unconditionally.

Client-side edits (`.html .js .jsx .ts .tsx .vue .svelte .mjs .css`) require a `browser` witness before `transition to=COMPLETE`; a project with `.gm/browser-config.json` requires one every turn regardless of edit count.

Phase graph (default; a project's `.gm/instructions/fsm/graph.json` can define another): SPECIFY -> PROVE -> EMIT -> STATE -> CONC -> SEC -> RES -> DECIDE -> COMPLETE, with feedback edges from every later stage back to an earlier one. Each transition is an explicit `transition {to:"PHASE"}` dispatch. COMPLETE gate: worktree clean, remote pushed, PRD empty, mutables resolved, residual-scan fired, Git committed and pushed (and consolidated any upstream merges). CI green must then occur(`.ci-validated`'s `head_sha` matches current HEAD), browser-witness coverage, submodules clean, no hedge language. Mark it via `fs_write {path:".gm/exec-spool/.ci-validated", content:"{\"head_sha\":\"<sha>\"}"}` after a green CI watch.

Spool input from PowerShell must be UTF-8 no-BOM. First-turn body is `{"prompt":"<user request>"}`; later dispatches may use `{}`. SESSION_ID threads through every dispatch body once known (a prior response's `session_id` field, or a fresh id on first boot) -- plugkit rejects an empty one. Batch independent dispatches in one message; never edit the same file twice in one block.

Any violations of ASD-STE100 must be immediately resolved while working, before continuing.
