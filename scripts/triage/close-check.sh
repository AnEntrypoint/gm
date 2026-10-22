#!/usr/bin/env bash
# Usage: scripts/triage/close-check.sh <row-id> <witness-dispatch-id>
# Confirms a close landed: the witness is in the dispatch ledger and no row file in .gm/prd carries the row id.
# Row files are named <id lowercased>-<hash>.yml, so the test reads each file's id: line instead of the name.
# Run after every prd-resolve. Output: "verified" or the failing check. Exit 0 only when both hold.
# $GM_ROOT overrides the gm checkout.
root=${GM_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}
row=$1
witness=$2
ok=1
if ! grep -q -- "$witness" "$root/.gm/exec-spool/.dispatch-ledger.json" 2>/dev/null; then
  echo "witness $witness not in ledger"
  ok=0
fi
for f in "$root"/.gm/prd/*.yml; do
  [ -f "$f" ] || continue
  if grep -qxE -- "id: ['\"]?$row['\"]?" "$f"; then
    echo "row $row still open ($f)"
    ok=0
    break
  fi
done
[ "$ok" = 1 ] && echo "verified $row"
exit $((1 - ok))
