#!/usr/bin/env bash
# Usage: scripts/triage/close-check.sh <row-id> <witness-dispatch-id>
# Confirms a close landed: the witness is in the dispatch ledger and the row file is gone from .gm/prd.
# Run after every prd-resolve. Output: "verified" or the failing check. Exit 0 only when both hold.
# $GM_ROOT overrides /workspace/gm.
root=${GM_ROOT:-/workspace/gm}
row=$1
witness=$2
ok=1
if ! grep -q -- "$witness" "$root/.gm/exec-spool/.dispatch-ledger.json" 2>/dev/null; then
  echo "witness $witness not in ledger"
  ok=0
fi
if [ -f "$root/.gm/prd/$row.yml" ]; then
  echo "row $row still open"
  ok=0
fi
[ "$ok" = 1 ] && echo "verified $row"
exit $((1 - ok))
