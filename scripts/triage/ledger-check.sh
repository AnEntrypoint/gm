#!/usr/bin/env bash
# Usage: scripts/triage/ledger-check.sh <dispatch-id>...
# Checks each dispatch id against <root>/.gm/exec-spool/.dispatch-ledger.json, where <root> is $GM_ROOT or
# /workspace/gm. A close needs its witness in the ledger, so run this before and after every prd-resolve.
# Output: "<id> in-ledger" or "<id> MISSING" per id. Exit 1 when any id is missing.
root=${GM_ROOT:-/workspace/gm}
ledger="$root/.gm/exec-spool/.dispatch-ledger.json"
rc=0
for id in "$@"; do
  if [ -f "$ledger" ] && grep -q -- "$id" "$ledger"; then
    echo "$id in-ledger"
  else
    echo "$id MISSING"
    rc=1
  fi
done
exit $rc
