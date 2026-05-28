# Plugkit lifecycle automation map (iter20)

**Principle:** policy automates at existing lifecycle points; no new verbs for plumbing.

## Lifecycle points plugkit already owns

| Hook | When it fires | Existing purpose | New responsibilities |
|---|---|---|---|
| **Watcher boot** | Once per daemon start | Bind WASI/host imports, start inotify loop, write `.status.json` | Ensure managed `.gitignore`. Sweep stale spool. |
| **Instruction dispatch (turn entry)** | First `instruction` body after >30s idle | Attach `auto_recall` pack, set `phase` | Refresh `.gitignore` if stale. Scan `.claude/gm-log/<day>/hook.jsonl` for poll patterns, emit `deviation.spool-poll`. |
| **Every verb response** | After verb body computed | Return `{ok, data, ...}` | Attach `policy` field if gate verdict applies. Agent reads the gate verdict from the same response. |
| **memorize-fire, transition, prd-add, etc.** | Per agent dispatch | Their primary action | Each can side-effect into the gitignore-refresh / browser-edit witness path when their body implies a file mutation. |
| **Heartbeat tick (each watcher loop iteration)** | Continuous | Update `.status.json` ts | Detect dirty wrapper SHA, log to deviation stream. |

## Audit MOVE list -> lifecycle binding

(From `.gm/gm-automation-audit.md`. None of these become a new verb.)

- `getManagedGitignoreEntries` + `getMustStayTracked` + `ensureManagedGitignore` -> **watcher boot** + **heartbeat tick** (idempotent re-check; rewrites only if hash differs).
- `SPOOL_POLL_PATTERNS` + `isSpoolPollCommand` + `stripHeredocsAndStringLiterals` -> **instruction dispatch (turn entry)** scans `hook.jsonl` for matching bash commands in the last N seconds; emits `deviation.spool-poll` events. No hard block — soft enforcement only.
- `isBrowserRunningFile` + `recordBrowserEdit` -> fold into the **verb response post-processing** for memorize/transition that includes a file path in their body. When plugkit sees a verb body referencing a browser-running file, it auto-records the hash into `.gm/exec-spool/.turn-browser-edits.json` without the agent dispatching anything.
- `checkDispatchGates` (140 LOC of gate logic) -> **every verb response**. Plugkit computes the gate verdict inline and returns `{ok: false, gate_denied: true, reason: ...}` when an operation would violate policy. The verb itself doesn't run; the agent sees the denial in the same response shape it was already going to read.
- `isInstructionTurnEntry` + `readUserPromptForRecall` -> already runs on **instruction dispatch (turn entry)** as part of auto_recall — just port the policy choice (what counts as a turn boundary, how to derive the query) into Rust.

## Anti-patterns (do NOT do)

- ❌ Add `.gitignore-ensure` verb — wrong shape; automation handles it.
- ❌ Add `record-edit` verb — the agent already dispatches memorize/transition; plugkit observes from inside those.
- ❌ Add `bootstrap-plan` verb — watcher boot runs the plan itself.
- ❌ Write to `.claude/settings.json` from plugkit OR gm — platform-lock.
- ❌ Hard-block via PreToolUse hook from any platform — that's an agent-host concern, not plugkit's.

## Implementation order (after J3 + J4 land)

1. **J3 (in flight)**: gitignore at watcher boot. 27-entry list + must-stay-tracked list + block merge.
2. **J4 (in flight)**: delete platform-lock hook installation (Claude Code .claude/settings.json writes, spool-poll-gate.js entirely).
3. **J5 (queued)**: gm-starter/lib/skill-bootstrap.js shrinks; the gitignore/hook functions deleted. Bootstrap flow becomes pure plumbing.
4. **Follow-up (file)**: port `checkDispatchGates` to plugkit verb-response post-processing.
5. **Follow-up (file)**: port browser-edit recording into verb-response side-effect.
6. **Follow-up (file)**: port spool-poll detection into instruction-dispatch turn-entry scan.
