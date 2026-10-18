#!/usr/bin/env bash
# Platform: POSIX only (uses /proc). Cross-platform port: scripts/triage/runner-status.mjs.
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
out_dir = os.path.join(os.path.dirname(sys.argv[1]), "out")
newest = max((os.path.getmtime(os.path.join(out_dir, n)) for n in os.listdir(out_dir) if n.endswith(".json")), default=0) if os.path.isdir(out_dir) else 0
out_age = int(time.time() - newest) if newest else None
RESPONSE_PROVES_LIVE_SECONDS = 300
responded_recently = out_age is not None and out_age < RESPONSE_PROVES_LIVE_SECONDS
if alive and age < 300000:
    verdict = "ALIVE"
elif alive and busy:
    verdict = "BUSY"
elif not alive and responded_recently:
    verdict = "SERVING-STATUS-STALE"
else:
    verdict = "DEAD"
print(f"{verdict}: heartbeat age {age} ms, pid {pid} {'present' if alive else 'ABSENT'}, runner {d.get('runner_version')}, queue {d.get('queue_depth')}, last response {out_age if out_age is not None else 'none'} s ago")
if verdict == "SERVING-STATUS-STALE":
    print("status pid absent but responses are being written: do not start a second watcher; confirm with a health dispatch")
print("plugins:", ", ".join(f"{k} {v}" for k, v in sorted(d.get("loaded_plugin_versions", {}).items())))
sys.exit(0 if verdict != "DEAD" else 1)
PY
