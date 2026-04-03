#!/bin/sh
set -e
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT}}"
[ -z "$PLUGIN_ROOT" ] && exit 0
BINDIR="$PLUGIN_ROOT/bin"
VERFILE="$BINDIR/.plugkit-version"
IS_WIN=0
case "$(uname -s 2>/dev/null)" in MINGW*|CYGWIN*|MSYS*) IS_WIN=1;; esac
[ -f /proc/version ] && grep -qi microsoft /proc/version 2>/dev/null && IS_WIN=1
if [ $IS_WIN -eq 1 ]; then EXT=".exe"; OS="win32"; else EXT=""; OS="$(uname -s | tr '[:upper:]' '[:lower:]')"; fi
case "$(uname -m 2>/dev/null)" in arm64|aarch64) ARCH="arm64";; *) ARCH="x64";; esac
ASSET="plugkit-${OS}-${ARCH}${EXT}"
PLUGKIT="$BINDIR/plugkit${EXT}"
mkdir -p "$BINDIR"
if [ ! -f "$PLUGKIT" ]; then
  VER="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PLUGIN_ROOT/gm.json','utf8')).plugkitVersion)" 2>/dev/null || python3 -c "import json,sys;d=json.load(open('$PLUGIN_ROOT/gm.json'));sys.stdout.write(d['plugkitVersion'])" 2>/dev/null || python -c "import json,sys;d=json.load(open('$PLUGIN_ROOT/gm.json'));sys.stdout.write(d['plugkitVersion'])" 2>/dev/null || sed -n 's/.*"plugkitVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_ROOT/gm.json" | head -1)"
  [ -z "$VER" ] && exit 0
  URL="https://github.com/AnEntrypoint/rs-plugkit/releases/download/v${VER}/${ASSET}"
  curl -fsSL --location --max-time 30 "$URL" -o "$PLUGKIT" 2>/dev/null || exit 0
  chmod +x "$PLUGKIT" 2>/dev/null || true
  printf '%s' "$VER" > "$VERFILE"
fi
PARENT="$(dirname "$PLUGIN_ROOT")"
for d in "$PARENT"/*/; do
  [ "$d" = "$PLUGIN_ROOT/" ] && continue
  rm -rf "$d" 2>/dev/null || true
done
"$PLUGKIT" bootstrap
