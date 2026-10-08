#!/usr/bin/env bash
# Build the gm plugkit wasm from rs-plugkit origin/main and swap it into the live runner home.
# Usage: sideload-plugkit.sh   (from anywhere). Refuses unless rs-plugkit HEAD contains origin/main
# and its source tree is clean. Records the built source in ~/.agentplug/plugins/gm.build.json and
# waits for the daemon to report the new content hash. Backups sit beside each replaced file.
set -euo pipefail

gm_root=$(cd "$(dirname "$0")/../.." && pwd)
src="$gm_root/rs-plugkit"
plugins="$HOME/.agentplug/plugins"
tools="$HOME/.gm-tools"
status="$HOME/.agentplug/daemon-status.json"

git -C "$src" fetch --quiet origin main
if ! git -C "$src" merge-base --is-ancestor origin/main HEAD; then
  echo "refused: rs-plugkit HEAD $(git -C "$src" rev-parse --short HEAD) does not contain origin/main $(git -C "$src" rev-parse --short origin/main)" >&2
  exit 1
fi
dirty=$(git -C "$src" status --porcelain -- crates Cargo.toml Cargo.lock)
if [ -n "$dirty" ]; then
  echo "refused: rs-plugkit source tree is dirty:" >&2
  echo "$dirty" >&2
  exit 1
fi

(cd "$src" && cargo build -p rs-plugkit --release --target wasm32-wasip1 --features slim)

built="$src/target/wasm32-wasip1/release/rs_plugkit.wasm"
source_sha=$(git -C "$src" rev-parse HEAD)
origin_sha=$(git -C "$src" rev-parse origin/main)
wasm_sha=$(sha256sum "$built" | cut -d' ' -f1)
wasm_bytes=$(wc -c < "$built" | tr -d ' ')
ts=$(date +%s)

mkdir -p "$plugins" "$tools"
for dest in "$plugins/gm.wasm" "$tools/plugkit.wasm"; do
  if [ -f "$dest" ]; then cp -p "$dest" "$dest.bak-sideload-$ts"; fi
  cp "$built" "$dest.tmp-sideload"
  mv -f "$dest.tmp-sideload" "$dest"
done

manifest="$plugins/gm.build.json"
printf '{"plugin":"gm","source_sha":"%s","origin_main_sha":"%s","wasm_sha256":"%s","wasm_bytes":%s,"built_at":%s,"source_root":"%s"}\n' \
  "$source_sha" "$origin_sha" "$wasm_sha" "$wasm_bytes" "$ts" "$src" > "$manifest.tmp"
mv -f "$manifest.tmp" "$manifest"

needle="\"gm\":\"$wasm_sha\""
for _ in $(seq 1 60); do
  content=$(cat "$status" 2>/dev/null || true)
  if [[ "$content" == *"$needle"* ]]; then
    echo "daemon loaded gm $wasm_sha built from rs-plugkit $source_sha"
    exit 0
  fi
  sleep 1
done
echo "daemon did not report gm $wasm_sha within 60s; manifest at $manifest" >&2
exit 1
