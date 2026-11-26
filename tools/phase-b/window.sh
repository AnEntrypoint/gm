#!/bin/bash
cd "$(git rev-parse --show-toplevel)"
PB=tools/phase-b
OUT=${1:-runs/phase-b}
BUILD=${RED_BUILD:-build/rel-72}
HEAVY=${HEAVY_JOBS_CHECK:-/workspace/bevy/scripts/heavy-jobs.cjs}
LOG=$OUT/window.txt
rm -rf "$OUT" && mkdir -p "$OUT" && : > "$LOG"
SCRATCH_BASE=${GM_SCRATCH:-/workspace/tmp/gm}
mkdir -p "$SCRATCH_BASE"
export TMPDIR=$SCRATCH_BASE HOME=$SCRATCH_BASE/rel72-home GMNEW_AUTO_UPDATE=0 PLAYWRITER_NO_SANDBOX=1 PLAYWRITER_BROWSER_PATH=/data/cache/bin/chromium
GM_TOOL=$BUILD/native/components/tool/gm-tool
GM=$BUILD/native/components/host/gm
FAILED=0

say() { echo "$*" | tee -a "$LOG"; }
part_of() {
  if [ "${PART:-all}" = all ]; then cat; return; fi
  awk -v k="${PART//[!0-9]/}" -v n="$1" '{ a[NR] = $0 } END { s = int((NR + n - 1) / n); for (i = (k - 1) * s + 1; i <= k * s && i <= NR; i++) print a[i] }'
}

if [ "${PART:-all}" = build ]; then
  git update-ref refs/remotes/origin/main HEAD
  cmake --preset x64-linux-release -B "$BUILD" -DGMNEW_VERSION="$(git rev-parse --short=7 HEAD)-1" > "$OUT/build.log" 2>&1 && cmake --build "$BUILD" -j3 >> "$OUT/build.log" 2>&1
  code=$?
  ninja -C "$BUILD" -t cleandead >> "$OUT/build.log" 2>&1
  say "BUILD_END rc=$code head=$(git rev-parse --short HEAD)"
  say "PART_DONE $code"
  exit $code
fi

fetch_head_digest() { sha256sum .git/FETCH_HEAD 2>/dev/null | cut -c1-16; }
ORIGIN_EXPECT=$(git rev-parse refs/remotes/origin/main)
FETCH_HEAD_EXPECT=$(fetch_head_digest)

guard() {
  local ref digest
  ref=$(git rev-parse refs/remotes/origin/main)
  digest=$(fetch_head_digest)
  if [ "$ref" = "$ORIGIN_EXPECT" ] && [ "$digest" = "$FETCH_HEAD_EXPECT" ]; then
    say "ORIGIN_SAME $1"
  else
    say "ORIGIN_CHANGED $1 ref=$ref expected=$ORIGIN_EXPECT fetch_head=$digest expected=$FETCH_HEAD_EXPECT"
    FAILED=1
  fi
}

gate_clear() {
  vmstat 1 2 > "$OUT/vmstat-gate.txt"
  tail -n 2 "$OUT/vmstat-gate.txt" | sed 's/^/vmstat: /' | tee -a "$LOG"
  local si so heavy
  read -r si so <<< "$(awk 'END{print $7, $8}' "$OUT/vmstat-gate.txt")"
  timeout 60 node "$HEAVY" > "$OUT/heavy-gate.txt" 2>&1
  heavy=$?
  say "gate t=$(date -u +%T) sample_si=$si sample_so=$so heavy_rc=$heavy heavy=$(head -c 160 "$OUT/heavy-gate.txt" | tr '\n' ' ')"
  [ "$si" -lt 1000 ] && [ "$so" -lt 1000 ] && [ "$heavy" -eq 0 ]
}

step() {
  local label=$1 pid rc
  shift
  case $label in w-*) guard "before $label";; esac
  timeout 900 "$@" > "$OUT/$label.log" 2>&1 &
  pid=$!
  say "RUN $label PID=$pid t=$(date -u +%T)"
  wait $pid
  rc=$?
  say "RUN $label RC=$rc"
  case $label in
    w-*) guard "after $label";;
    red-*) git update-ref refs/remotes/origin/main "$ORIGIN_EXPECT"; say "SHIM_REANCHOR $label";;
  esac
  return $rc
}

say "ORIGIN_START ref=$ORIGIN_EXPECT fetch_head=$FETCH_HEAD_EXPECT head=$(git rev-parse HEAD)"
say "HEAD $(git rev-parse --short HEAD) tree=$(git status --short | wc -l) build=$($GM --version)"
say "GATE_READ_FIRST"
clear=0
for _ in $(seq 60); do
  if gate_clear; then clear=1; break; fi
  sleep 30
done
[ $clear -eq 1 ] || { say "NOT_CLEAR"; exit 3; }
say "CLEAR"
WITNESS_PARTS=${WITNESS_PARTS:-3}
if [ "${PART:-all}" = all ] || [[ "${PART:-all}" == witnesses* ]]; then
  $GM install --local "$BUILD" --source "$PWD" > "$OUT/home-install.txt" 2>&1 || { FAILED=1; say "FAILED home-install"; }

  say "WITNESSES ${PART:-all}"
  for name in $(sed -n 's/^CHECK("\([^"]*\)".*/\1/p' native/include/gm/checks.def | part_of "$WITNESS_PARTS"); do
    step "w-$name" "$GM_TOOL" check "$GM" "$name" || { FAILED=1; say "FAILED w-$name"; }
  done
  say "WITNESSES_DONE FAILED=$FAILED"

  if [ "${PART:-all}" = all ] || [ "$PART" = "witnesses$WITNESS_PARTS" ]; then
    mkdir -p "$OUT/parity/ws"
    guard "before parity"
    HOME=/config timeout 900 python3 $PB/rpc-until.py "$GM" "$OUT/parity/ws" $PB/parity-body.js "$OUT/parity/out.txt" > "$OUT/parity/probe.txt" 2>&1
    say "PARITY_RC=$?"
    guard "after parity"
    python3 -I $PB/parity-verdict.py "$OUT/parity/out.txt" && say "PARITY_OK" || { FAILED=1; say "PARITY_FAILED"; }
  fi
fi

REDS_PARTS=${REDS_PARTS:-4}
if [ "${PART:-all}" = all ] || [[ "${PART:-all}" == reds[0-9]* ]]; then
  ids=$(python3 $PB/red.py ids | tr ' ' '\n' | grep . | part_of "$REDS_PARTS")
  say "REDS ${PART:-all}: $(echo $ids | wc -w) reds: $(echo $ids)"
  for id in $ids; do
    RED_LOGS=$OUT/reds step "red-$id" python3 $PB/red.py "$id" || { FAILED=1; say "FAILED red-$id"; }
  done
  say "REDS_DONE FAILED=$FAILED"
fi
say "HEAD_END $(git rev-parse --short HEAD) changes=$(git status --short | wc -l)"
say "WINDOW_END FAILED=$FAILED t=$(date -u +%T)"
say "PART_DONE $FAILED"
exit $FAILED
