# Task FSM (rs-exec)

## States

- **Queued**
- **Running** — `--exec-process-mode` child spawned; foreground
- **Backgrounded** — exceeded 15s inline threshold; now polled via `getTask`
- **Completed** — exit captured; output in store
- **Killed** — SIGTERM/SIGKILL by session-cleanup or timeout
- **Drained** — Completed + output read by getAndClearOutput

## Transitions

```
Queued --(spawn ok)-->              Running
Queued --(spawn fail)-->            Completed (is_error=true)
Running --(exit <= 15s)-->          Completed
Running --(>15s deadline)-->        Backgrounded
Backgrounded --(child exits)-->     Completed
Completed --(getAndClearOutput)-->  Drained
Running | Backgrounded --(session-end OR explicit kill)--> Killed
Killed --(wait exit)-->             Drained
```

## Invariants — stdout isolation

The open bug: "output from parallel background tasks leaks into current foreground task's stdout."

Design fix:
1. Each task has an **OwnedPipe**: distinct `stdout_tx/stderr_tx` channels; never writes to shared runner stdout.
2. Foreground task's Bash result is composed **only** from its own OwnedPipe buffer. Background tasks' pipes drain into their per-task files under `$TMPDIR/rs-exec-task-<id>.out`.
3. `backgroundTaskId` notifications are framed JSON lines on a SEPARATE control channel (`$TMPDIR/rs-exec-ctrl-<sid>.jsonl`), NOT inlined into foreground stdout.
4. `rs-plugkit cmd_exec` reads only (task-output + control-channel-for-this-task-id); never reads the runner-global stdout.

Tested by: two concurrent tasks A (slow, background) + B (fast, foreground); assert B's output contains ONLY B's bytes.
