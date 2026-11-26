#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)"
STAMP=${1:-b13}
shift
PARTS_LIST=${*:-build witnesses1 witnesses2 witnesses3 reds1 reds2 reds3 reds4}
for part in $PARTS_LIST; do
  out=runs/phase-$STAMP-$part
  result=${GM_SCRATCH:-/workspace/tmp/gm}/window-$STAMP-$part.result
  case $part in
    witnesses*) export GATE_EXCLUSIVE=1;;
    *) unset GATE_EXCLUSIVE;;
  esac
  GATE_TREE=$(git rev-parse --short HEAD) PART=$part node /workspace/hyperagent/scripts/gate-ticket.cjs run gm-$part -- bash tools/phase-b/window.sh "$out" > "$result" 2>&1
  code=$?
  echo "PARTS $part exit=$code"
  [ "$code" = 0 ] || exit "$code"
done
echo PARTS_DONE 0
