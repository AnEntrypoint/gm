#!/usr/bin/env bash
# Resource snapshot for gm: RAM, CPU, disk, gm process groups, listening sockets.
# Usage: scripts/triage/resources.sh            one snapshot
#        scripts/triage/resources.sh --watch N  repeat every N seconds
# Output: one block per snapshot. Exit 1 when a gm-owned TCP listener binds a
# non-loopback address (the no-open-network-ports rule), else 0.

snapshot() {
  echo "== $(date -u +%H:%M:%SZ) load $(cut -d' ' -f1-3 /proc/loadavg)"
  free -m | awk '/^Mem:/ {printf "ram  used %dM avail %dM total %dM\n", $3, $7, $2}'
  awk '/^(SwapTotal|SwapFree):/ {v[$1]=$2} END {printf "swap used %dM of %dM\n", (v["SwapTotal:"]-v["SwapFree:"])/1024, v["SwapTotal:"]/1024}' /proc/meminfo
  top -b -n1 | awk '/^%Cpu/ {printf "cpu  user %s sys %s idle %s\n", $2, $4, $8}'
  df -Pm / /workspace 2>/dev/null | awk 'NR>1 {printf "disk %-12s used %s of %sM (%s)\n", $6, $3, $2, $5}'
  # gm-owned process groups, matched by command line
  # match the executable (first word, basename) so wrapper shells that quote the path are not counted
  ps -eo rss=,args= | awk '
    { exe = $2; sub(".*/", "", exe) }
    exe == "node" && /gm-mcp-server\.mjs/ {g="gm-mcp"}
    exe == "node" && /dispatch-verb\.mjs/ {g="dispatch-verb"}
    exe == "node" && /batch-characters\.mjs/ {g="other-batch"}
    exe ~ /^agentplug-runner/ {g="runner"}
    g {n[g]++; r[g]+=$1}
    {g=""}
    END {for (k in n) printf "proc %-14s count %d rss %dM\n", k, n[k], r[k]/1024}' | sort
  echo "net  $(ss -tn state established 2>/dev/null | tail -n +2 | wc -l) established tcp"
  listeners=$(ss -ltnp 2>/dev/null | tail -n +2)
  echo "listen $(echo "$listeners" | grep -c .) tcp listener(s)"
  echo "$listeners" | awk '{print "  " $4 "  " $6}' | sed 's/users:((//; s/))//' | cut -c1-140
  # gm owns a listener only when the process is gm-mcp or the runner
  bad=$(echo "$listeners" | grep -E 'agentplug|gm-mcp' | grep -vE '127\.0\.0\.1|\[::1\]' | grep -c .)
  if [ "$bad" -gt 0 ]; then echo "FLAG gm listener on a non-loopback address: $bad"; return 1; fi
  return 0
}

if [ "$1" = "--watch" ]; then
  while true; do snapshot; sleep "${2:-60}"; done
fi
snapshot
exit $?
