#!/bin/sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

die() {
  echo "setup: $*" >&2
  exit 1
}

[ "$#" -eq 0 ] || die "setup takes no arguments: run ./setup.sh, then the install command it prints"

command -v git >/dev/null 2>&1 || die "git is not installed. Install git, then run this again."
command -v node >/dev/null 2>&1 || die "node is not installed. The checks and the commit gate run on node 22 or later: https://nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || die "node 22 or later is needed. This is node $(node -v). Install it from https://nodejs.org, then run ./setup.sh again."

echo "setup: node $(node -v), git $(git --version | cut -d' ' -f3)"

if node tools/gate.mjs >/tmp/gm-setup-gate.out 2>&1; then
  echo "setup: gate: passed"
else
  cat /tmp/gm-setup-gate.out >&2
  die "the gate failed. Read the message above, fix it, then run this again."
fi

node --input-type=module -e "import('./tools/prefetch.mjs').then((m) => m.prefetch())"

echo "setup: install the native gm with this command. It writes the release into ~/.gmnew/current and sets mcpServers.gm in ~/.claude.json to that binary, so each new session starts native. It runs no build and no npm install."
echo "  sh \"$here/scripts/install.sh\""
echo "setup: done. The manual is in docs/index.html, and README.md has the same command."

if command -v cmake >/dev/null 2>&1 && command -v ninja >/dev/null 2>&1; then
  echo "setup: native build (release preset), the parity reference binary"
  if cmake --preset release >/dev/null && cmake --build build/release >/dev/null; then
    echo "setup: native binary: $here/build/release/native/components/host/gm"
  else
    echo "setup: the native build failed. The installed gm is unaffected."
  fi
else
  echo "setup: cmake and ninja are not both installed, so the native build was skipped. The installed gm is unaffected."
fi
