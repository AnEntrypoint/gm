#!/bin/sh
# gm setup. Run it once after a clone, and again whenever you like: it is safe to repeat. It checks the tools gm needs, installs
# the one dependency when it is missing, pulls origin main when the checkout has no changes to tracked files (and runs the gate on the
# result), runs the gate, and prints the two add-mcp commands that install gm. It runs neither command and writes nothing.
#
#   ./setup.sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

die() {
  echo "setup: $*" >&2
  exit 1
}

[ "$#" -eq 0 ] || die "setup takes no arguments: run ./setup.sh, then the add-mcp commands it prints"

command -v git >/dev/null 2>&1 || die "git is not installed. Install git, then run this again."
command -v node >/dev/null 2>&1 || die "node is not installed. gm needs Node 20 or later: https://nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || die "node is $(node -v). gm needs Node 20 or later."
command -v npm >/dev/null 2>&1 || die "npm is not installed. It comes with node: https://nodejs.org"

echo "setup: node $(node -v), git $(git --version | cut -d' ' -f3)"

# 1. The dependency. It is installed only when it is missing, so a repeat run does not touch node_modules.
if node -e "import('acorn').then(() => process.exit(0), () => process.exit(1))" >/dev/null 2>&1; then
  echo "setup: dependencies are installed"
else
  echo "setup: installing dependencies (npm ci)"
  npm ci --no-audit --no-fund || die "npm ci failed. Check the network, then run this again."
fi

# 2. Update from origin main. The check is the same one the relay runs every hour: it pulls only a clean checkout, and it undoes a pull that
# the gate rejects. A checkout with local changes is reported, not touched.
if git remote get-url origin >/dev/null 2>&1; then
  node --input-type=module -e "import('./tools/update.mjs').then((m) => m.checkForUpdate(process.cwd(), { log: (text) => console.log('setup: ' + text) })).then((r) => console.log('setup: update check: ' + r.state))"
else
  echo "setup: no origin remote, so there is nothing to pull"
fi

# 3. The gate. It checks syntax, ASCII, the docs, the sources, the wiki, the skills and a smoke run.
if node --input-type=module -e "import('./src/gate.mjs').then((m) => m.runGate(process.cwd())).then((r) => { console.log('setup: gate: ' + (r.ok ? 'passed' : 'FAILED: ' + r.failed.join(', '))); process.exitCode = r.ok ? 0 : 1; })"; then
  :
else
  die "the gate failed. Read the message above, fix it, then run this again."
fi

# 4. The install. gm is installed with add-mcp, run through npx. The first command only lists the gm entries. The second removes every gm
# entry, old or new. The third installs gm for Claude Code at user level, where the relay starts in the directory each session opens, so one
# entry serves every project. setup prints the commands and runs none of them.
case "$here" in
  *[[:space:]]*) die "the checkout path has a space, and add-mcp splits a command string at spaces: $here" ;;
esac
echo "setup: install gm with these commands, in this order. Remove matches any server whose name contains gm, so list first."
cat <<EOF
  npx -y add-mcp@2.6.1 list -g
  npx -y add-mcp@2.6.1 remove gm -g -y
  npx -y add-mcp@2.6.1 "node $here/tools/relay.mjs" -n gm -g -a claude-code -y
EOF
echo "setup: done. Nothing was run. The manual is in docs/index.html, and README.md has the same commands."
