---
name: ssh
description: Run shell commands on remote SSH hosts via exec:ssh. Reads targets from ~/.claude/ssh-targets.json. Use for deploying, monitoring, or controlling remote machines.
---

# exec:ssh — Remote SSH Execution

**Use gm subagents for all independent work items. Invoke all skills in the chain: planning → gm-execute → gm-emit → gm-complete → update-docs.**


Runs shell commands on a remote host over SSH. No shell open, no manual connection — just write the command.

## Setup

Create `~/.claude/ssh-targets.json`:

```json
{
  "default": {
    "host": "192.168.1.10",
    "port": 22,
    "username": "pi",
    "password": "yourpassword"
  },
  "prod": {
    "host": "10.0.0.1",
    "username": "ubuntu",
    "keyPath": "/home/user/.ssh/id_rsa"
  }
}
```

Fields: `host` (required), `port` (default 22), `username` (required), `password` OR `keyPath` + optional `passphrase`.

## Usage

```
exec:ssh
<shell command>
```

Target a named host with `@name` on the first line:

```
exec:ssh
@prod
sudo systemctl restart myapp
```

Multi-line scripts work:

```
exec:ssh
cd /var/log && tail -20 syslog
```

## Process Persistence

SSH sessions kill child processes on close. To keep a process running after the command returns:

```
exec:ssh
sudo systemctl reset-failed myunit 2>/dev/null; systemd-run --unit=myunit bash -c 'your-long-running-command'
```

Always call `systemctl reset-failed <unit>` before reusing a unit name, or use a unique timestamped name:

```
exec:ssh
systemd-run --unit=job-$(date +%s) bash -c 'nohup myprogram &'
```

Fallback if systemd unavailable:

```
exec:ssh
setsid nohup bash -c 'myprogram > /tmp/out.log 2>&1' &
```

## Dependency

Requires `ssh2` npm package. Install in `~/.claude/gm-tools`:

```
exec:bash
cd ~/.claude/gm-tools && npm install ssh2
```

The plugin searches: `~/.claude/gm-tools/node_modules/ssh2`, `~/.claude/plugins/node_modules/ssh2`, then global.
