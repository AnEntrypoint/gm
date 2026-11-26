#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)"
STAMP=${1:-b13}
for part in build witnesses reds1 reds2 reds3 reds4; do
  out=runs/phase-$STAMP-$part
  result=${GM_SCRATCH:-/workspace/tmp/gm}/window-$STAMP-$part.result
  PART=$part node /workspace/hyperagent/scripts/gate-ticket.cjs run gm-$part -- bash tools/phase-b/window.sh "$out" > "$result" 2>&1
  code=$?
  echo "PARTS $part exit=$code"
  [ "$code" = 0 ] || exit "$code"
done
echo PARTS_DONE 0
