---
name: process-management
description: PM2 process lifecycle. MANDATORY for all servers, workers, daemons. Invoke from gm-execute when any long-running process is needed. Return to gm-execute when done.
---

# Process Management — PM2 Lifecycle

You are managing long-running processes. Invoked from EXECUTE phase.

**GRAPH POSITION**: Sub-skill of `gm-execute`. Invoked and returns.
- **Entry**: `gm-execute` encounters server/worker/daemon requirement → invoke `process-management` skill
- **Return**: Lifecycle task complete → return to `gm-execute` to continue EXECUTE phase
- **Snake**: Process fails to start or behaves incorrectly → debug here, then return to `gm-execute` with witnessed status

## TRANSITIONS

**RETURN (normal)**:
- Process started and confirmed running → return to `gm-execute`
- Process stopped/cleaned up → return to `gm-execute`

**SNAKE (failure)**:
- Process crashes on start → debug logs here, surface error to `gm-execute`, let EXECUTE phase decide whether to snake to PLAN
- Port conflict detected → resolve here, then return to `gm-execute`
- Orphans found → clean up here, then return to `gm-execute`

## PRE-CHECK (mandatory before any start)

```
exec:nodejs
const { execSync } = require('child_process');
console.log(execSync('npx pm2 list', { encoding: 'utf8' }));
```

If process already running with same name → stop and delete first.
If different process using same port → stop it first.
Never start a duplicate. Never stack processes.

## START

```
exec:nodejs
const { execSync } = require('child_process');
execSync('npx pm2 start <file> --name <name> --watch --no-autorestart', { stdio: 'inherit' });
```

- `--watch`: hot reload on file changes
- `--no-autorestart`: prevents infinite crash loops
- Always name every process explicitly

## STATUS AND LOGS

```
exec:nodejs
const { execSync } = require('child_process');
console.log(execSync('npx pm2 list', { encoding: 'utf8' }));
console.log(execSync('npx pm2 logs <name> --lines 50 --nostream', { encoding: 'utf8' }));
```

## STOP AND CLEANUP

Always clean up when work is done. Orphaned processes = gate violation in COMPLETE.

```
exec:nodejs
const { execSync } = require('child_process');
execSync('npx pm2 stop <name>', { stdio: 'inherit' });
execSync('npx pm2 delete <name>', { stdio: 'inherit' });
```

## ORPHAN DETECTION

Run `npx pm2 list` — any process not started in the current session = orphan. Delete immediately.

## CONSTRAINTS

**Never**: start without pre-check | direct node/bun/python for servers (use PM2) | leave orphans | skip cleanup before COMPLETE | `Bash(pm2 ...)` — use exec:nodejs with execSync

**Always**: pre-check before start | name every process | watch enabled | autorestart disabled | delete on session end

---

**→ RETURN**: Lifecycle task complete → return to `gm-execute` skill.
**↩ SNAKE**: Process failure → debug logs, surface to `gm-execute`, let EXECUTE decide next step.
