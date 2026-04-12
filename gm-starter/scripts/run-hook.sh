#!/bin/sh
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT}}"
[ -z "$PLUGIN_ROOT" ] && exit 0
PLUGKIT="$PLUGIN_ROOT/bin/plugkit"
[ -f "$PLUGIN_ROOT/bin/plugkit.exe" ] && PLUGKIT="$PLUGIN_ROOT/bin/plugkit.exe"
if [ ! -f "$PLUGKIT" ]; then
  sh "$PLUGIN_ROOT/scripts/bootstrap.sh"
  PLUGKIT="$PLUGIN_ROOT/bin/plugkit"
  [ -f "$PLUGIN_ROOT/bin/plugkit.exe" ] && PLUGKIT="$PLUGIN_ROOT/bin/plugkit.exe"
fi
[ ! -f "$PLUGKIT" ] && exit 0
"$PLUGKIT" hook "$1"
