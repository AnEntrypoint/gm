#!/usr/bin/env bash
# Platform: POSIX only (uses /proc, setsid). No Windows port; restart the runner by hand on Windows.
root=${1:-$PWD}
runner=${AGENTPLUG_RUNNER:-$HOME/.gm-tools/agentplug-runner}
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  case "$(readlink /proc/$p/exe 2>/dev/null)" in *agentplug-runner*) [ "$p" != "$$" ] && kill "$p";; esac
done
sleep 2
log="$root/.gm/agentplug-runner.log"
mkdir -p "$root/.gm"
cd "$root" && setsid nohup "$runner" spool >"$log" 2>&1 &
echo "runner log: $log"
sleep 6
"$(dirname "$0")/runner-status.sh" "$root"
