#!/usr/bin/env bash
# Usage: scripts/triage/runner-restart.sh [project-root]
# Stops every agentplug-runner process, starts the shared daemon, then registers the project with it
# (spool). The shared daemon serves every project; `spool` alone registers and serves nothing.
# Output: the runner log path, then the runner-status line. Exit 0 when the status reports ALIVE.
# Platform: POSIX only (uses /proc, setsid). Restart by hand on Windows.
root=${1:-$PWD}
runner=${AGENTPLUG_RUNNER:-$HOME/.gm-tools/agentplug-runner}
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  case "$(readlink /proc/$p/exe 2>/dev/null)" in *agentplug-runner*) [ "$p" != "$$" ] && kill "$p";; esac
done
sleep 2
# Orphaned requests (.inflight with no live owning dispatch) block the serial git lane. Move them to a
# dated quarantine directory, never delete them; a live request is left in place.
q="$root/.gm/exec-spool/in-quarantine-orphan-$(date -u +%Y%m%dT%H%M%S)"
moved=0
while IFS= read -r f; do
  id=$(basename "$f" .txt.inflight)
  if ! pgrep -f -- "$id" >/dev/null 2>&1; then
    mkdir -p "$q/$(dirname "${f#"$root/.gm/exec-spool/"}")" && mv "$f" "$q/${f#"$root/.gm/exec-spool/"}" && moved=$((moved+1))
  fi
done < <(find "$root/.gm/exec-spool/in" -name '*.inflight' -type f 2>/dev/null)
echo "quarantined orphan requests: $moved"
log="$root/.gm/agentplug-runner.log"
mkdir -p "$root/.gm"
setsid nohup "$runner" daemon >"$root/.gm/agentplug-daemon.log" 2>&1 </dev/null &
sleep 5
cd "$root" && setsid nohup "$runner" spool >"$log" 2>&1 </dev/null &
echo "runner log: $log"
echo "daemon log: $root/.gm/agentplug-daemon.log"
sleep 6
status=$(node "$(dirname "$0")/runner-status.mjs" 2>&1 | head -1)
echo "$status"
case "$status" in ALIVE*) exit 0;; *) exit 1;; esac
