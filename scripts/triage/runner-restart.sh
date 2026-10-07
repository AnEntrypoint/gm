#!/usr/bin/env bash
# Stop every agentplug-runner by /proc exe (never pkill -f: the pattern matches the calling shell's own
# command line and kills it), then start one spool watcher detached. Usage: runner-restart.sh [project-root]
root=${1:-$PWD}
runner=${AGENTPLUG_RUNNER:-$HOME/.gm-tools/agentplug-runner}
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  [ "$(basename "$(readlink /proc/$p/exe 2>/dev/null)")" = "agentplug-runner" ] && [ "$p" != "$$" ] && kill "$p"
done
sleep 2
cd "$root" && setsid nohup "$runner" spool >"${TMPDIR:-/tmp}/agentplug-runner.log" 2>&1 &
sleep 6
"$(dirname "$0")/runner-status.sh" "$root"
