---
name: gm-skill
description: Canonical universal harness — AI-native software engineering via skill-driven orchestration; bootstraps plugkit for task execution and session isolation
allowed-tools: Skill, Read, Write
---

# GM — Universal Skill Harness

Single canonical body re-exported by every platform-specific gm-<platform> skill. All 15 platforms share this identical surface. AI-native software engineering orchestrated as a continuous chain: PLAN → EXECUTE → EMIT → VERIFY → UPDATE-DOCS, no stops between phases, no permission gates, the user's first request is the authorization for the whole chain.

## Bootstrap

`bun x gm-plugkit@latest --daemon` downloads the correct platform binary, verifies SHA256, starts the spool watcher daemon. Idempotent. Call once at session start. Subsequent calls no-op.

Session-ID threading: at skill invoke, generate or detect SESSION_ID (env `SESSION_ID` or `uuid()`). Every rs-exec RPC body and every spool-written task body carries `sessionId: "<id>"`. Task-scoped cleanup (deleteTask, getTask, appendOutput, killSessionTasks) requires matching sessionId. Absence is hard-rejected by the handler — no orphaned tasks.

## Spool Dispatch Surface

Every dispatch goes through the spool. Tool args are ephemeral, inline, do not survive compaction, are not replayable. A file-based surface inverts every one of those: the request lives on disk before the watcher reads it, the watcher is detached from the agent process, the output triplet (`.out`, `.err`, `.json`) is auditable after the fact.

Write to `.gm/exec-spool/in/<lang>/<N>.<ext>` (nodejs, python, bash, typescript, go, rust, c, cpp, java, deno) or `in/<verb>/<N>.txt` (codesearch, recall, memorize, wait, sleep, status, close, browser, runner, type, kill-port, forget, feedback, learn-status, learn-debug, learn-build, discipline, pause, health). Watcher streams `out/<N>.out` and `out/<N>.err` line-by-line, then writes `out/<N>.json` metadata (exitCode, durationMs, timedOut, startedAt, endedAt) at completion.

Only `git` and `gh` run directly via the Bash tool. Inline `node script.js`, `Bash(exec:<anything>)`, JSON-form dispatch — all denied at the hook layer.

## Daemonize by Default

The watcher returns a task_id immediately and tails the logfile up to 30 seconds of wall-clock before returning. Short tasks complete inside the window and look synchronous. Long tasks return the task_id with partial output and continue running. The agent never re-spawns a long task to check on it — that orphans the first one.

Resumption grammar: `tail` drains additional output without blocking. `watch` blocks until a regex matches or timeout elapses. `wait` is a pure timer. `sleep` blocks on a specific task's output. `close` terminates. Every RPC response carries `running_task_ids` for the calling session so the agent never loses track of background work it spawned.

## Hooks Throw, Never Mutate

A hook that blocks a tool call throws an error with an imperative instruction string. It does not rewrite the call's arguments into a self-failing form. The thrown error is the entire denial surface. Throw form is for "use a different tool" (the model adapts policy); mutate form would be for "run this corrected version" (the model reads it as a broken tool and retries with simpler commands, reinforcing the wrong mental model).

## Meaning Through Haiku

Any task whose correctness depends on understanding — summarize, classify, extract intent, rewrite, translate, semantic dedup, score, label, decide-if-two-texts-mean-the-same — routes through `Agent(subagent_type='gm:textprocessing', model='haiku', ...)`. One subagent per item, N items in N parallel calls in one message. Code does mechanics well and meaning badly. A keyword-list or regex-on-meaning-phrases loop deciding semantic questions is a stub that ships a green check that lies.

## End-to-End Chaining

When SKILL.md includes `end-to-end: true`, the adapter parses stdout for trailing JSON: `{"nextSkill": "...", "context": {...}, "phase": "..."}`. Non-null `nextSkill` → invoke `Skill(skill="gm:<nextSkill>")` with context, repeat until null. Five skill invocations auto-chain into one user invocation.

Every task returns complete: taskId, exitCode, durationMs, timedOut, stdout, stderr. Background tasks return immediately with task_id; continue with `in/status/<N>.txt` (tail), `in/watch/<N>.txt` (watch), or `in/close/<N>.txt` (close).
