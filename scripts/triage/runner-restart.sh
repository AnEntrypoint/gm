#!/usr/bin/env bash
root=${1:-$PWD}
runner=${AGENTPLUG_RUNNER:-$HOME/.gm-tools/agentplug-runner}
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  case "$(readlink /proc/$p/exe 2>/dev/null)" in *agentplug-runner*) [ "$p" != "$$" ] && kill "$p";; esac
done
sleep 2
cd "$root" && setsid nohup "$runner" spool >"${TMPDIR:-/tmp}/agentplug-runner.log" 2>&1 &
sleep 6
"$(dirname "$0")/runner-status.sh" "$root"
