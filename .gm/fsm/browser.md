# Browser FSM (rs-exec)

Governs Chrome Portable lifecycle tied to a session.

## States

- **Absent** — no chrome.exe owned by this session
- **Spawning** — child process launched, --remote-debugging-port bind pending
- **Ready** — debugging port responds to `/json/version`
- **InUse** — at least one exec:browser task bound
- **Idle** — Ready but no tasks for `BROWSER_IDLE_MS` (default 120s)
- **Closing** — kill signal sent, waiting for exit
- **Dead** — process gone; profile lock released

## Transitions

```
Absent --(session-first-browser-task)-->           Spawning
Spawning --(port-responds within 20s)-->           Ready
Spawning --(timeout / bind-fail)-->                Dead
Ready --(task-bind)-->                             InUse
InUse --(all-tasks-drained)-->                     Idle
Idle --(task-bind)-->                              InUse
Idle --(BROWSER_IDLE_MS elapsed)-->                Closing
InUse --(session-end)-->                           Closing   (drain-then-kill)
Ready --(session-end)-->                           Closing
Closing --(process-exited OR 5s force-kill)-->     Dead
Dead --(session-next-browser-task)-->              Spawning
```

## Invariants

1. **One Chrome per session.** Two sessions never share a profile dir; mapping held in `session_browsers: DashMap<SessionId, BrowserProc>`.
2. **Never kill in InUse.** Killing while tasks are bound corrupts their output; session-end must transition InUse → Closing which waits for `drain_session_tasks()` before signalling kill.
3. **No cross-session kill.** A zombie reaper MAY kill chrome.exe whose parent PID isn't any live runner, but MUST NOT kill chrome owned by `session_browsers`.
4. **Profile lock guard.** Spawning fails-fast if `<profile>/SingletonLock` exists and its owning PID is alive — emits structured error `BROWSER_PROFILE_LOCKED { pid, profile }` instead of burning through 20 retries.
5. **Session end is idempotent.** Repeated `session-cleanup --session=X` calls in Closing/Dead are no-ops.

## Guardrails against known regressions

Past Chrome-reaper attempts oscillated between:
- Too eager (killed in-use browsers mid-task) — fix: InUse is a hard block; only Idle/Ready/Closing can transition to Dead via reaper.
- Too lazy (left zombies across sessions) — fix: session-end unconditionally walks the FSM to Closing; idle-timeout adds a second pressure valve.

Orphan reaper runs at **runner startup only** (like exec-process-mode reaper). Scans chrome.exe whose `parent_pid` is not in the live-runner set and whose command-line contains `--remote-debugging-port=`; kills with 5s SIGTERM-then-SIGKILL. Never runs mid-session.

## Persistence

`session_browsers` is in-memory; on runner restart we intentionally LOSE the mapping (they're orphans anyway) and the startup reaper sweeps. Session-pinned port info is written to `$TMPDIR/cc-browser-<sid>.json` for best-effort recovery in rare race where a session survives a runner restart.

## Observability

Every transition emits `{ ts, session, from, to, reason }` to `$TMPDIR/cc-browser-fsm.log` (ring, 1MB). `plugkit doctor` reads this.
