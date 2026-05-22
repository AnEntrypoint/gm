#!/bin/sh
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT}}"
[ -z "$PLUGIN_ROOT" ] && exit 0
PLUGKIT_JS="$PLUGIN_ROOT/bin/plugkit.js"
[ ! -f "$PLUGKIT_JS" ] && exit 0
node "$PLUGKIT_JS" hook "$1"
