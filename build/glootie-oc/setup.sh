#!/bin/bash
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
mkdir -p "$SCRIPT_DIR/.opencode/agents"
mkdir -p "$SCRIPT_DIR/.opencode/plugins"
cp "$SCRIPT_DIR/agents/gm.md" "$SCRIPT_DIR/.opencode/agents/" 2>/dev/null || true
npm install --save-dev 2>/dev/null || true
echo "Setup complete!"
