# Session FSM (rs-exec)

## States

- **Unknown** — session id seen for the first time
- **Active** — at least one task in last `SESSION_IDLE_MS` (default 15m)
- **Idle** — no tasks for `SESSION_IDLE_MS`; resources may be drained
- **Closing** — explicit `session-cleanup` received; draining
- **Dead** — fully cleaned up; id may be re-used

## Transitions

```
Unknown --(first task submission)-->    Active
Active --(task completes; tasks_alive==0 for SESSION_IDLE_MS)--> Idle
Idle   --(new task submission)-->       Active
Active --(session-cleanup cmd)-->       Closing
Idle   --(session-cleanup cmd)-->       Closing
Idle   --(runner shutdown)-->           Closing
Closing --(drain tasks + kill browser + delete files)--> Dead
Dead   --(any cmd with same sid)-->     Unknown   (treat as fresh)
```

## Invariants

1. Session-scoped state (`session_browsers`, pending-task counts, output buffers) is accessed ONLY while state != Dead.
2. `drain_session_tasks()` must complete before browser FSM is asked to Close.
3. `Closing → Dead` is write-once; double-cleanup is a no-op.
