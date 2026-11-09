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
command -v node >/dev/null 2>&1 || die "node is not installed. gm needs Node 22 or later: https://nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || die "gm needs Node 22 or later. This is node $(node -v). Install it from https://nodejs.org, then run ./setup.sh again."
command -v npm >/dev/null 2>&1 || die "npm is not installed. It comes with node: https://nodejs.org"

echo "setup: node $(node -v), git $(git --version | cut -d' ' -f3)"

if node -e "import('acorn').then(() => process.exit(0), () => process.exit(1))" >/dev/null 2>&1; then
  echo "setup: dependencies are installed"
else
  echo "setup: installing dependencies (npm ci)"
  npm ci --no-audit --no-fund || die "npm ci failed. Check the network, then run this again."
fi

if git remote get-url origin >/dev/null 2>&1; then
  node --input-type=module -e "import('./tools/update.mjs').then((m) => m.checkForUpdate(process.cwd(), { log: (text) => console.log('setup: ' + text) })).then((r) => console.log('setup: update check: ' + r.state))"
else
  echo "setup: no origin remote, so there is nothing to pull"
fi

if node --input-type=module -e "import('./src/gate.mjs').then((m) => m.runGate(process.cwd())).then((r) => { console.log('setup: gate: ' + (r.ok ? 'passed' : 'FAILED: ' + r.failed.join(', '))); process.exitCode = r.ok ? 0 : 1; })"; then
  :
else
  die "the gate failed. Read the message above, fix it, then run this again."
fi

node --input-type=module -e "import('./tools/prefetch.mjs').then((m) => m.prefetch())"

node --input-type=module -e "import('./src/registration.mjs').then((m) => console.log('setup: ' + m.registrationStatus().text))"

echo "setup: install the native gm with this command. It writes the release into ~/.gmnew/current and sets mcpServers.gm in ~/.claude.json to that binary, so each new session starts native. It runs nothing itself."
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
