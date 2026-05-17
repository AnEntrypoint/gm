---
name: gm-skill
description: Canonical universal harness — AI-native software engineering via skill-driven orchestration; bootstraps plugkit for task execution and session isolation
allowed-tools: Skill, Read, Write
---

# GM — Universal Skill Harness

Single canonical body re-exported by every platform-specific gm-<platform> skill. All 15 platforms share this identical plugkit dispatch surface.

AI-native software engineering orchestrated via skill chain: PLAN → EXECUTE → EMIT → VERIFY → UPDATE-DOCS.

**Bootstrap pattern**: `bun x gm-plugkit@latest --daemon` downloads the correct platform binary, verifies SHA256, and starts the spool watcher daemon. Call once at session start; idempotent on subsequent calls. All execution routes through the file-spool: write to `.gm/exec-spool/in/<lang>/<N>.<ext>` or `in/<verb>/<N>.txt`, poll `out/<N>.json` for results.

**Session-ID threading (no session-start hook)**: At skill invoke time, generate or detect SESSION_ID (env var `SESSION_ID` or `uuid()`). Pass `sessionId: "<id>"` in every rs-exec RPC body (spawn, tail, watch, etc.) and every spool-written task body. All task-scoped cleanup (deleteTask, getTask, appendOutput, killSessionTasks) requires matching sessionId. Absence is forbidden — hard reject by rs-exec handler.

**Spool dispatch surface**: Write to `.gm/exec-spool/in/<lang>/<N>.<ext>` (languages: nodejs, python, bash, typescript, go, rust, c, cpp, java, deno) or `in/<verb>/<N>.txt` (verbs: codesearch, recall, memorize, wait, sleep, status, close, browser, runner, etc.). Watcher executes and streams `out/<N>.out` (stdout) + `out/<N>.err` (stderr) line-by-line, then `out/<N>.json` metadata (exitCode, durationMs, timedOut, startedAt, endedAt) at completion.

**End-to-end skill chaining (skills-based platforms)**: When gm SKILL.md includes `end-to-end: true`, adapter detects signal and parses stdout for trailing JSON: `{"nextSkill": "...", "context": {...}, "phase": "..."}`. If nextSkill is non-null, invoke `Skill(skill="gm:<nextSkill>")` with context dict, repeat until null. This auto-chains 5 invocations into 1 user invocation.

Every task returns complete: taskId, exitCode, durationMs, timedOut, stdout, stderr. Background tasks return immediately with task_id; continue with `in/status/<N>.txt` (tail), `in/watch/<N>.txt` (watch), or `in/close/<N>.txt` (close).
