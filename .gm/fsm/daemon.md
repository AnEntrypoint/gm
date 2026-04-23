# Daemon FSM (rs-exec)

## States

- **NotStarted**
- **Spawning** — child daemon launched with `CREATE_NO_WINDOW | DETACHED_PROCESS`
- **Binding** — trying FIXED_PORT (32882) then 4 retries; if all fail, fall through to ephemeral
- **Listening** — axum server bound; port written to `$TMPDIR/glootie-runner.port`
- **Crashed** — pid gone; port file stale
- **Respawning** — next cmd re-enters Spawning

## Transitions & logging

```
NotStarted --(any cmd)-->            Spawning
Spawning --(listen ok on 32882)-->   Listening [reason=fixed]
Spawning --(listen ok on ephemeral)--> Listening [reason=fallback, attempts=5]
Spawning --(listen fail)-->          Crashed [reason=<io-error>]
Listening --(pid gone)-->            Crashed
Crashed --(any cmd)-->               Respawning --> Spawning
```

## Known issue fixes

1. **FIXED_PORT fallback silent mismatch.** Current code logs only the bound port. New: on every `Binding→Listening` transition, log which branch fired. `plugkit --version --deps` shows `port=32882 [fixed]` or `port=37609 [fallback after 5 attempts]`.
2. **Respawn loops.** Add crash-counter; if 3 Crashed in 30s, emit `DAEMON_FLAPPING` and refuse to respawn for 60s. Prevents port-bind storms.
3. **Stale `.port` file.** Reader MUST verify the pid in the file is alive before using the port. Stale → treat as NotStarted.
