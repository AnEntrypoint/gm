---
name: process-management
description: PM2 process lifecycle management. MANDATORY for all servers, workers, and daemons. Invoke when entering EXECUTE phase for any long-running process.
---

# Process Management — PM2 Lifecycle

You are managing long-running processes. Invoke this skill before starting any server, worker, or daemon.

**GRAPH POSITION**: Sub-skill of EXECUTE phase.
- **Invoke**: When `gm-execute` skill encounters any server/worker/daemon requirement → invoke `process-management` skill
- **Return**: After lifecycle task complete → return to `gm-execute` skill to continue EXECUTE phase

## PRE-CHECK (mandatory before any start)

Always check for running processes before starting:

```
exec:bash
bun x gm-exec bash pm2 list
```

If process already running:
- Same name → stop and delete first, then restart
- Different name but same port → stop that process first
- Never start a duplicate. Never stack processes.

## START A PROCESS

```
exec:bash
bun x gm-exec bash pm2 start <file> --name <name> --watch --no-autorestart
```

- `--watch`: enables hot reload on file changes
- `--no-autorestart`: prevents infinite restart loops on crash
- Always name every process explicitly

## STATUS AND LOGS

```
exec:bash
bun x gm-exec bash pm2 list
bun x gm-exec bash pm2 logs <name> --lines 50
bun x gm-exec bash pm2 show <name>
```

## STOP AND CLEANUP

Always clean up processes when work is done:

```
exec:bash
bun x gm-exec bash pm2 stop <name>
bun x gm-exec bash pm2 delete <name>
```

Orphaned processes = gate violation. Clean up before COMPLETE.

## ORPHAN DETECTION

```
exec:bash
bun x gm-exec bash pm2 list
```

Any process not started in current session = orphan. Delete immediately:

```
exec:bash
bun x gm-exec bash pm2 delete <name>
```

## CONSTRAINTS

**Never**: start without pre-check | use direct node/bun/python for servers | leave orphaned processes | skip cleanup before COMPLETE

**Always**: pre-check before start | name every process | watch enabled | autorestart disabled | delete on completion

**Orphaned processes = gate violation in COMPLETE phase.**

---

**→ RETURN**: After lifecycle task complete → return to `gm-execute` skill to continue EXECUTE phase.
