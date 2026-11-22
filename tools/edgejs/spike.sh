#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(realpath -m "${EDGEJS_WORK:-/workspace/tmp/gm/edgejs}")
SRC=$WORK/src
BUILD=$WORK/build
JOBS=${EDGEJS_JOBS:-2}
PART_SECONDS=${EDGEJS_PART_SECONDS:-1500}
EDGE=${EDGEJS_BIN:-$BUILD/edge}
MEASURE="python3 -I $HERE/measure.py"

pinned() { python3 -I -c 'import json, sys; pins = json.load(open(sys.argv[1])); [print(name, p["repo"], p["commit"], p["path"], p["sha256"] or "-") for name, p in pins.items()]' "$HERE/pins.json"; }

fetch() {
  rm -rf "$SRC" && mkdir -p "$WORK/git" "$SRC"
  pinned | while read -r name repo commit path digest; do
    store=$WORK/git/$name
    [ -d "$store/.git" ] || git init -q "$store"
    git -C "$store" cat-file -e "$commit^{commit}" 2>/dev/null || git -C "$store" fetch -q --depth 1 "https://github.com/$repo.git" "$commit"
    actual=$(git -C "$store" archive --format=tar "$commit" | sha256sum | cut -d' ' -f1)
    if [ "$digest" != "$actual" ]; then echo "edgejs fetch: $name tree at $commit has sha256 $actual, the pin says $digest" >&2; exit 1; fi
    mkdir -p "$SRC/$path" && git -C "$store" archive --format=tar "$commit" | tar -x -C "$SRC/$path"
    echo "fetched $name $commit sha256 $actual ($(git -C "$store" ls-tree -r --name-only "$commit" | wc -l) files)"
  done
}

configure() {
  $MEASURE configure cmake -S "$SRC" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release -DEDGE_NAPI_PROVIDER=quickjs -DEDGE_BUILD_NAPI_TESTS=OFF -DEDGE_QUICKJS_WEBASSEMBLY=OFF -DEDGE_BUILD_CLI=ON
}

build() {
  set +e
  timeout "$PART_SECONDS" $MEASURE build cmake --build "$BUILD" --target edge -j"$JOBS"
  code=$?
  set -e
  [ "$code" = 124 ] && echo "edgejs build: part ended at ${PART_SECONDS} s; run build again to continue" && exit 124
  exit "$code"
}

outputs() {
  ls -l "$EDGE"
  find "$BUILD" -name '*.a' -printf '%s %P\n' | sort -n | tail -n 25
  du -sh "$BUILD"
  "$EDGE" --version || true
}

startup() {
  for run in 1 2 3; do $MEASURE "startup-$run" "$EDGE" -e '0'; done
  $MEASURE startup-console "$EDGE" -e 'console.log(process.version, Object.keys(process.versions).join(","))'
}

smoke() {
  gcc -O2 -shared -fPIC -I "$SRC/napi/include" "$HERE/smoke/host.c" -o "$WORK/host.node"
  cp "$HERE/smoke/smoke.mjs" "$WORK/smoke.mjs"
  (cd "$WORK" && $MEASURE smoke "$EDGE" smoke.mjs)
}

"$@"
