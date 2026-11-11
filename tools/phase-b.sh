#!/usr/bin/env bash
set -o pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root" || exit 1
build="${1:-build/release}"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "phase-b: tracked changes are uncommitted; commit them with tools/ship.sh first"
  exit 1
fi
cmake --preset release > /dev/null || { echo "phase-b: configure failed"; exit 1; }
cmake --build "$build" -j 8 > /dev/null || { echo "phase-b: build failed"; exit 1; }
node tools/check-build.mjs "$build" || { echo "phase-b: check-build failed; nothing marked, nothing to push"; exit 1; }
node tools/parity-contract.mjs "$build/native/components/host/gm" all || { echo "phase-b: parity contract failed; nothing marked"; exit 1; }
head="$(git rev-parse HEAD)"
printf '%s\n' "$head" > "$build/phase-b.pass"
echo "phase-b: pass at $head; push with tools/ship.sh --push"
