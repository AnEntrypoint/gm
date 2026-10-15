#!/usr/bin/env bash
# One-call watcher health: heartbeat age, pid liveness, versions, loaded plugins, queue.
# Usage: runner-status.sh [project-root]   (default: current directory)
# Verdicts (the daemon's own limit is stale_after_ms 20000, so a heartbeat older than that is not alive):
#   ALIVE                 heartbeat fresh and the status pid is a live process (not a zombie)
#   BUSY                  pid live and busy_until in the future
#   SERVING-STATUS-STALE  heartbeat stale but a response was written in the last 20 s: confirm with a health dispatch
#   DEAD                  neither (exit 1): start the existing local binary as spool-adapter.md gives
root=${1:-$PWD}
f="$root/.gm/exec-spool/.status.json"
[ -f "$f" ] || { echo "no status file at $f -- watcher never started here"; exit 2; }
python3 - "$f" <<'PY'
import json, os, sys, time
LIMIT_MS = 20000
d = json.load(open(sys.argv[1]))
now_ms = int(time.time() * 1000)
age = now_ms - d.get("ts", 0)
pid = d.get("pid")
def live(p):
    if not p or not os.path.exists(f"/proc/{p}"):
        return False
    try:
        with open(f"/proc/{p}/status") as h:
            return not any(line.startswith("State:") and "Z" in line for line in h)
    except OSError:
        return False
alive = live(pid)
busy = d.get("busy_until", 0) > now_ms
out_dir = os.path.join(os.path.dirname(sys.argv[1]), "out")
newest = max((os.path.getmtime(os.path.join(out_dir, n)) for n in os.listdir(out_dir) if n.endswith(".json")), default=0) if os.path.isdir(out_dir) else 0
out_age_ms = int(time.time() * 1000 - newest * 1000) if newest else None
if alive and age < LIMIT_MS:
    verdict = "ALIVE"
elif alive and busy:
    verdict = "BUSY"
elif out_age_ms is not None and out_age_ms < LIMIT_MS:
    verdict = "SERVING-STATUS-STALE"
else:
    verdict = "DEAD"
print(f"{verdict}: heartbeat age {age} ms, pid {pid} {'live' if alive else 'absent or zombie'}, runner {d.get('runner_version')}, queue {d.get('queue_depth')}, last response {out_age_ms // 1000 if out_age_ms is not None else 'none'} s ago")
if verdict == "SERVING-STATUS-STALE":
    print("heartbeat is stale but a response is fresh: do not start a second watcher; confirm with a health dispatch")
print("plugins:", ", ".join(f"{k} {v}" for k, v in sorted(d.get("loaded_plugin_versions", {}).items())))
sys.exit(0 if verdict != "DEAD" else 1)
PY
