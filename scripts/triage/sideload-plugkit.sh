#!/usr/bin/env bash
# Usage: sideload-plugkit.sh [--run <cmd>] [overlay-path ...]
# Builds rs-plugkit HEAD (origin/main when HEAD lacks it) plus the named overlay paths (rs-plugkit-relative, copied from the
# working tree) in a per-lane scratch export, so other lanes' uncommitted edits never enter the
# build. The swap into the daemon runs under the sideload lease (~/.agentplug/sideload.lock,
# atomic mkdir); the first lease saves the pre-lease wasm to <dest>.release and every lease end
# restores it. --run executes <cmd> while the build is live and exits with its status.
# Env: GM_LANE names the scratch dir (default lane-<pid>); SIDELOAD_LOCK_WAIT_S (default 900).
set -euo pipefail
os_tmp=${TMPDIR:-$(dirname "$(mktemp -u)")}

gm_root=$(cd "$(dirname "$0")/../.." && pwd -P)
src="$gm_root/rs-plugkit"
plugins="$HOME/.agentplug/plugins"
tools="$HOME/.gm-tools"
status="$HOME/.agentplug/daemon-status.json"
lock="$HOME/.agentplug/sideload.lock"
lane="${GM_LANE:-lane-$$}"
scratch="$gm_root/.gm/lane-build/$lane"
wait_s="${SIDELOAD_LOCK_WAIT_S:-900}"
run_cmd=""
overlay=()
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run_cmd="$2"; shift 2 ;;
    *) overlay+=("$1"); shift ;;
  esac
done

git -C "$src" fetch --quiet origin main
src_ref=HEAD
if ! git -C "$src" merge-base --is-ancestor origin/main HEAD; then
  src_ref=origin/main
  echo "rs-plugkit HEAD $(git -C "$src" rev-parse --short HEAD) lacks origin/main $(git -C "$src" rev-parse --short origin/main); building the origin/main tip" >&2
fi

rm -rf "$scratch"
mkdir -p "$scratch"
git -C "$src" archive "$src_ref" | tar -x -C "$scratch"
for p in ${overlay[@]+"${overlay[@]}"}; do
  case "$p" in /*|*..*) echo "refused: overlay path must be relative and inside rs-plugkit: $p" >&2; exit 1 ;; esac
  mkdir -p "$scratch/$(dirname "$p")"
  cp "$src/$p" "$scratch/$p"
done
dirty=false
if [ "${#overlay[@]}" -gt 0 ]; then dirty=true; fi

cargo_home=${CARGO_HOME:-$HOME/.cargo}
if ! { mkdir -p "$cargo_home" 2>/dev/null && [ -w "$cargo_home" ]; }; then
  export CARGO_HOME="$gm_root/.gm/lane-build/cargo-home-$(id -u)"
  echo "sideload-plugkit: CARGO_HOME $cargo_home is not writable; using $CARGO_HOME" >&2
  mkdir -p "$CARGO_HOME"
fi
if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-wasip1; then
  rustup_home=${RUSTUP_HOME:-$HOME/.rustup}
  export RUSTUP_HOME="$os_tmp/rustup-$(id -u)"
  echo "sideload-plugkit: wasm32-wasip1 is not installed under $rustup_home; using $RUSTUP_HOME" >&2
  if [ ! -d "$RUSTUP_HOME" ] && [ -d "$rustup_home" ]; then
    cp -a "$rustup_home" "$RUSTUP_HOME"
  fi
  rustup target add wasm32-wasip1 >&2
fi

(cd "$scratch" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$src/target}" cargo build -p rs-plugkit --release --target wasm32-wasip1 --features slim)

built="${CARGO_TARGET_DIR:-$src/target}/wasm32-wasip1/release/rs_plugkit.wasm"
source_sha=$(git -C "$src" rev-parse "$src_ref")
origin_sha=$(git -C "$src" rev-parse origin/main)
wasm_sha=$(sha256sum "$built" | cut -d' ' -f1)
wasm_bytes=$(wc -c < "$built" | tr -d ' ')
ts=$(date +%s)

mkdir -p "$plugins" "$tools" "$(dirname "$lock")"
acquired=false
waited=0
while [ "$acquired" = false ]; do
  if mkdir "$lock" 2>/dev/null; then
    echo "$$" > "$lock/pid"
    acquired=true
  else
    holder=$(cat "$lock/pid" 2>/dev/null || echo "")
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$lock"
      continue
    fi
    if [ "$waited" -ge "$wait_s" ]; then
      echo "refused: sideload lease held by pid ${holder:-unknown} for ${wait_s}s" >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  fi
done

restore() {
  for dest in "$plugins/gm.wasm" "$tools/plugkit.wasm"; do
    if [ -f "$dest.release" ]; then
      cp -p "$dest.release" "$dest.tmp-restore"
      mv -f "$dest.tmp-restore" "$dest"
      rm -f "$dest.release"
    fi
  done
  rm -rf "$lock"
}
trap restore EXIT

for dest in "$plugins/gm.wasm" "$tools/plugkit.wasm"; do
  if [ -f "$dest" ] && [ ! -f "$dest.release" ]; then
    cp -p "$dest" "$dest.release.tmp"
    mv -f "$dest.release.tmp" "$dest.release"
  fi
  cp "$built" "$dest.tmp-sideload"
  mv -f "$dest.tmp-sideload" "$dest"
done

manifest="$plugins/gm.build.json"
printf '{"plugin":"gm","source_sha":"%s","origin_main_sha":"%s","wasm_sha256":"%s","wasm_bytes":%s,"built_at":%s,"source_root":"%s","lane":"%s","overlay_count":%s,"dirty":%s}\n' \
  "$source_sha" "$origin_sha" "$wasm_sha" "$wasm_bytes" "$ts" "$src" "$lane" "${#overlay[@]}" "$dirty" > "$manifest.tmp"
mv -f "$manifest.tmp" "$manifest"

needle="\"gm\":\"$wasm_sha\""
loaded=false
for _ in $(seq 1 60); do
  content=$(cat "$status" 2>/dev/null || true)
  if [[ "$content" == *"$needle"* ]]; then
    echo "daemon loaded gm $wasm_sha built from rs-plugkit $source_sha (lane $lane)"
    loaded=true
    break
  fi
  sleep 1
done
if [ "$loaded" = false ]; then
  echo "daemon did not report gm $wasm_sha within 60s; manifest at $manifest" >&2
  exit 1
fi

if [ -n "$run_cmd" ]; then
  bash -c "$run_cmd"
fi
