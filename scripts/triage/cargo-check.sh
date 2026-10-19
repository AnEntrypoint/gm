#!/usr/bin/env bash
# Usage: scripts/triage/cargo-check.sh [cargo check args...]   (default: -p rs-plugkit)
# Runs cargo check in rs-plugkit. An unwritable CARGO_HOME (a root-owned default such as
# /config/.cargo) falls back to a per-user home under the OS temp directory, since cargo fetches git dependencies
# (rs-search) into CARGO_HOME/git/db and fails with EACCES otherwise.
# Platform: POSIX shell only; no Windows port. Run under Git Bash on Windows.
set -euo pipefail
os_tmp=${TMPDIR:-$(dirname "$(mktemp -u)")}

root=$(cd "$(dirname "$0")/../.." && pwd -P)
writable() { mkdir -p "$1" 2>/dev/null && [ -w "$1" ]; }

cargo_home=${CARGO_HOME:-$HOME/.cargo}
if ! writable "$cargo_home"; then
  export CARGO_HOME="$os_tmp/cargo-home-$(id -u)"
  echo "cargo-check: CARGO_HOME $cargo_home is not writable; using $CARGO_HOME" >&2
  mkdir -p "$CARGO_HOME"
fi

if [ "$#" -eq 0 ]; then set -- -p rs-plugkit; fi
cd "$root/rs-plugkit"
cargo check "$@"
