#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRESET="${GMNEW_PRESET:-release}"
BUILD="$ROOT/build/$PRESET"
BINARY="$BUILD/native/components/host/gm"

configure() { cmake --preset "$PRESET" -S "$ROOT" -DGMNEW_BUILD_TESTS=ON; }
build() { configure; cmake --build "$BUILD"; }

case "${1:-}" in
    build) build ;;
    test) build; ctest --test-dir "$BUILD" --output-on-failure ;;
    doctor) build; "$BINARY" doctor ;;
    all) build; ctest --test-dir "$BUILD" --output-on-failure; "$BINARY" doctor ;;
    *) echo "usage: gm.sh build|test|doctor|all  (GMNEW_PRESET selects the preset, default release)"; exit 1 ;;
esac
