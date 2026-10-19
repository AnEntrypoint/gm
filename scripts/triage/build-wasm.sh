#!/usr/bin/env bash
# Platform: POSIX shell only; no Windows port. Run under Git Bash on Windows.
# Builds the slim rs-plugkit wasm guest. An unwritable CARGO_HOME or RUSTUP_HOME
# (a root-owned default) falls back to a per-user home under the OS temp directory, since cargo writes its
# git db and registry cache under CARGO_HOME and rustup installs the target under RUSTUP_HOME.
set -euo pipefail
os_tmp=${TMPDIR:-$(dirname "$(mktemp -u)")}

root=$(cd "$(dirname "$0")/../.." && pwd -P)
writable() { mkdir -p "$1" 2>/dev/null && touch "$1/.write-probe.$$" 2>/dev/null && rm -f "$1/.write-probe.$$"; }

cargo_home=${CARGO_HOME:-$HOME/.cargo}
if ! writable "$cargo_home"; then
  export CARGO_HOME="$os_tmp/cargo-home-$(id -u)"
  echo "build-wasm: CARGO_HOME $cargo_home is not writable; using $CARGO_HOME" >&2
  mkdir -p "$CARGO_HOME"
fi

rustup_home=${RUSTUP_HOME:-$HOME/.rustup}
if ! writable "$rustup_home"; then
  export RUSTUP_HOME="$os_tmp/rustup-$(id -u)"
  echo "build-wasm: RUSTUP_HOME $rustup_home is not writable; using $RUSTUP_HOME" >&2
  if [ ! -d "$RUSTUP_HOME" ] && [ -d "$rustup_home" ]; then
    cp -a "$rustup_home" "$RUSTUP_HOME"
  fi
  rustup_dir=$(dirname "$(command -v rustup)")
  if ! writable "$rustup_dir"; then
    mkdir -p "$CARGO_HOME/bin"
    cp -f "$(command -v rustup)" "$CARGO_HOME/bin/rustup"
    export PATH="$CARGO_HOME/bin:$PATH"
    echo "build-wasm: $rustup_dir is not writable; running rustup from $CARGO_HOME/bin" >&2
  fi
  rustup show active-toolchain >/dev/null 2>&1 || rustup toolchain install stable --profile minimal >&2
fi

if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-wasip1; then
  if ! rustup target add wasm32-wasip1 >&2; then
    export RUSTUP_HOME="$os_tmp/rustup-$(id -u)"
    echo "build-wasm: target add failed under $rustup_home; retrying with RUSTUP_HOME=$RUSTUP_HOME" >&2
    [ -d "$RUSTUP_HOME" ] || cp -a "$rustup_home" "$RUSTUP_HOME"
    rustup target add wasm32-wasip1 >&2
  fi
fi

cd "$root/rs-plugkit"
cargo build -p rs-plugkit --release --target wasm32-wasip1 --features slim
