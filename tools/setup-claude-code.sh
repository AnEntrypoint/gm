#!/bin/bash
set -euo pipefail

# Set up gm, playwriter and Claude Code in a Linux container, as root. Idempotent: a second run changes nothing.
# Usage: bash tools/setup-claude-code.sh
#
# Order: prerequisites, gm from the latest release (source build only as a fallback),
# the Chromium wrapper playwriter needs, gm on PATH, gm registered with Claude Code.
# gm install also places playwriter under ~/.gmnew/pw at the commit gm pins (git clone + npm ci).

REPO=AnEntrypoint/gm
BASE="https://github.com/$REPO/releases/download/latest"
GM_HOME="$HOME/.gmnew"

# 1. Prerequisites: git, curl, tar, sha256sum, and Node 22 or later with npm (the playwriter install needs them).
node_ok() { command -v node >/dev/null && command -v npm >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; }
if ! node_ok && [ -d /opt/node22/bin ]; then export PATH="/opt/node22/bin:$PATH"; fi
node_ok || { echo "setup: Node 22 or later with npm is required for playwriter" >&2; exit 1; }
if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  apt-get update -y
  apt-get install -y git curl ca-certificates
fi

# 2a. gm from the latest release: the archive for this machine, checked against manifest.json, then gm install.
case "$(uname -m)" in
  x86_64|amd64) TARGET=x64-linux ;;
  aarch64|arm64) TARGET=arm64-linux ;;
  *) TARGET= ;;
esac

install_release() {
  [ -n "$TARGET" ] || return 1
  local d file sha
  d="$(mktemp -d)"
  curl -fsSL --retry 5 --retry-delay 3 -o "$d/manifest.json" "$BASE/manifest.json" || return 1
  read -r file sha < <(node -e '
    const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).assets[process.argv[2]];
    if (!a) process.exit(1);
    console.log(a.file + " " + a.sha256);' "$d/manifest.json" "$TARGET") || return 1
  curl -fsSL --retry 5 --retry-delay 3 -o "$d/$file" "$BASE/$file" || return 1
  (cd "$d" && echo "$sha  $file" | sha256sum -c -) || return 1
  tar -xzf "$d/$file" -C "$d" || return 1
  "$d/gmnew-$TARGET/gm" install --local "$d/gmnew-$TARGET" || return 1
  rm -rf "$d"
}

# 2b. Fallback when the release has no asset for this machine or cannot be fetched: build from source.
install_source() {
  if ! command -v cmake >/dev/null || ! command -v ninja >/dev/null || ! command -v g++ >/dev/null; then
    apt-get update -y
    apt-get install -y cmake ninja-build g++ git
  fi
  local work
  work="$(mktemp -d)"
  git clone --depth 1 "https://github.com/$REPO" "$work/gm"
  cd "$work/gm"
  # Link group: verbs.cpp.o needs wiki.cpp.o from the same static archive, which GNU ld rejects in the default order.
  cmake --preset release -DCMAKE_CXX_LINK_EXECUTABLE='<CMAKE_CXX_COMPILER> <FLAGS> <CMAKE_CXX_LINK_FLAGS> <LINK_FLAGS> <OBJECTS> -o <TARGET> -Wl,--start-group <LINK_LIBRARIES> -Wl,--end-group'
  cmake --build build/release -j"$(nproc)"
  ./build/release/native/components/host/gm install --local ./build/release
  cd /
  rm -rf "$work"
}

if ! install_release; then
  echo "setup: release install failed, building gm from source" >&2
  install_source
fi
"$GM_HOME/current/gm" --version
[ -f "$GM_HOME/pw/bin/playwriter-project" ] || { echo "setup: playwriter was not installed under $GM_HOME/pw" >&2; exit 1; }

# 3. playwriter's default config starts /usr/bin/chromium, and root needs --no-sandbox to run it.
CH="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$CH" ] && [ ! -e /usr/bin/chromium ]; then
  printf '#!/bin/sh\nexec %s --no-sandbox "$@"\n' "$CH" > /usr/bin/chromium
  chmod +x /usr/bin/chromium
fi

# 4. gm install writes no client config: put gm on PATH and register it with Claude Code (user scope).
# ~/.gmnew/current is a symlink that gm update repoints, so both entries survive updates.
# Claude Code's own permissions are left alone; README.md "Tool permissions" has the optional deny list.
ln -sf "$GM_HOME/current/gm" /usr/local/bin/gm
# The gm checkout commits a project-scoped .mcp.json that runs /config/.gmnew/current/gm; point /config/.gmnew
# at the real install so that entry resolves here too instead of shadowing the user entry with a dead path.
if [ ! -e /config/.gmnew ]; then
  mkdir -p /config
  ln -s "$GM_HOME" /config/.gmnew
fi
if command -v claude >/dev/null; then
  claude mcp remove gm --scope user >/dev/null 2>&1 || true
  claude mcp add --scope user gm -- "$GM_HOME/current/gm" serve
fi
