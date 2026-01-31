#!/bin/bash
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OPENCODE_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
mkdir -p "$OPENCODE_CONFIG_DIR/plugins"
cp -r "$SCRIPT_DIR" "$OPENCODE_CONFIG_DIR/plugins/glootie"
echo "Global installation complete!"
