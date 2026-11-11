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
stamp_file="$(mktemp)"
cmake -DSOURCE_DIR="$root" -DOUTPUT="$stamp_file" -P cmake/gmnew_stamp.cmake || { echo "phase-b: stamp script failed"; exit 1; }
tree_stamp="$(sed -n 's/.*kBuildVersion = "\(.*\)";/\1/p' "$stamp_file")"
rm -f "$stamp_file"
built_stamp="$("$build/native/components/host/gm" --version | cut -d' ' -f1)"
if [ -z "$tree_stamp" ] || [ "$built_stamp" != "$tree_stamp" ]; then
  echo "phase-b: built stamp '$built_stamp' does not match the tree stamp '$tree_stamp'"
  exit 1
fi
node tools/check-build.mjs "$build" || { echo "phase-b: check-build failed; nothing marked, nothing to push"; exit 1; }
node tools/parity-contract.mjs "$build/native/components/host/gm" all || { echo "phase-b: parity contract failed; nothing marked"; exit 1; }
head="$(git rev-parse HEAD)"
printf '%s\n' "$head" > "$build/phase-b.pass"
echo "phase-b: pass at $head; push with tools/ship.sh --push"
