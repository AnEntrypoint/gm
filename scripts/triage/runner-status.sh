#!/usr/bin/env bash
# One-call watcher health: heartbeat age, pid liveness, versions, loaded plugins, queue.
# Usage: runner-status.sh [project-root]   (default: current directory)
root=${1:-$PWD}
f="$root/.gm/exec-spool/.status.json"
[ -f "$f" ] || { echo "no status file at $f -- watcher never started here"; exit 2; }
python3 - "$f" <<'PY'
import json, os, sys, time
d = json.load(open(sys.argv[1]))
age = int(time.time() * 1000) - d.get("ts", 0)
pid = d.get("pid")
alive = bool(pid) and os.path.exists(f"/proc/{pid}")
busy = d.get("busy_until", 0) > time.time() * 1000
verdict = "ALIVE" if alive and age < 300000 else ("BUSY" if alive and busy else "DEAD")
print(f"{verdict}: heartbeat age {age} ms, pid {pid} {'present' if alive else 'ABSENT'}, runner {d.get('runner_version')}, queue {d.get('queue_depth')}")
print("plugins:", ", ".join(f"{k} {v}" for k, v in sorted(d.get("loaded_plugin_versions", {}).items())))
sys.exit(0 if verdict != "DEAD" else 1)
PY
