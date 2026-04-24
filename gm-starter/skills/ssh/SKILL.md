---
name: ssh
description: Run shell commands on remote SSH hosts via exec:ssh. Reads targets from ~/.claude/ssh-targets.json. Use for deploying, monitoring, or controlling remote machines.
---

# exec:ssh — Remote SSH Execution

Runs shell commands on remote host. No manual connection needed.

## Setup

`~/.claude/ssh-targets.json`:
```json
{
  "default": { "host": "192.168.1.10", "port": 22, "username": "pi", "password": "pass" },
  "prod": { "host": "10.0.0.1", "username": "ubuntu", "keyPath": "/home/user/.ssh/id_rsa" }
}
```

Fields: `host` (required), `port` (default 22), `username` (required), `password` OR `keyPath` + optional `passphrase`.

## Usage

```
exec:ssh
<shell command>
```

Named host with `@name` on first line:
```
exec:ssh
@prod
sudo systemctl restart myapp
```

## Process Persistence

SSH kills child processes on close. To persist:
```
exec:ssh
sudo systemctl reset-failed myunit 2>/dev/null; systemd-run --unit=myunit bash -c 'your-command'
```

Unique name:
```
exec:ssh
systemd-run --unit=job-$(date +%s) bash -c 'nohup myprogram &'
```

Fallback (no systemd):
```
exec:ssh
setsid nohup bash -c 'myprogram > /tmp/out.log 2>&1' &
```

## Dependency

Requires `ssh2` npm package in `~/.claude/gm-tools`:
```
exec:bash
cd ~/.claude/gm-tools && npm install ssh2
```
