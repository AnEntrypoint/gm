#!/bin/sh
set -eu

REPO="AnEntrypoint/agentplug-bin"
GM_REPO="AnEntrypoint/gm"
GM_TOOLS_DIR="${HOME}/.gm-tools"
CLAUDE_SKILLS_DIR="${HOME}/.claude/skills"

log() { printf '%s\n' "$*" >&2; }

detect_asset() {
  plat=$(uname -s)
  arch=$(uname -m)
  case "$plat" in
    Darwin)
      case "$arch" in
        x86_64) echo "agentplug-runner-macos-x64" ;;
        arm64) echo "agentplug-runner-macos-arm64" ;;
        *) echo "" ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64) echo "agentplug-runner-linux-x64" ;;
        aarch64|arm64) echo "agentplug-runner-linux-arm64" ;;
        *) echo "" ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*)
      case "$arch" in
        x86_64) echo "agentplug-runner-windows-x64.exe" ;;
        *) echo "" ;;
      esac
      ;;
    *)
      echo ""
      ;;
  esac
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    log "FATAL: no sha256sum or shasum available to verify the download"
    exit 1
  fi
}

github_token() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    printf '%s' "$GITHUB_TOKEN"
  elif [ -n "${GH_TOKEN:-}" ]; then
    printf '%s' "$GH_TOKEN"
  fi
}

fetch_json() {
  url="$1"
  token=$(github_token)
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$token" ]; then
      curl -fsSL -H "Authorization: Bearer $token" "$url" 2>/dev/null
    else
      curl -fsSL "$url" 2>/dev/null
    fi
  elif command -v wget >/dev/null 2>&1; then
    if [ -n "$token" ]; then
      wget -qO- --header="Authorization: Bearer $token" "$url" 2>/dev/null
    else
      wget -qO- "$url" 2>/dev/null
    fi
  else
    log "FATAL: neither curl nor wget is available"
    exit 1
  fi
}

extract_tag_owning_asset_from_releases_json() {
  releases_json="$1"
  asset_name="$2"
  printf '%s' "$releases_json" | tr ',' '\n' | awk -v needle="\"name\": \"${asset_name}\"" '
    /"tag_name"/ { line = $0; sub(/^[^:]*: *"/, "", line); sub(/".*$/, "", line); current_tag = line }
    index($0, needle) > 0 { print current_tag; exit }
  '
}

resolve_installable_tag() {
  asset_name="$1"
  releases_json=$(fetch_json "https://api.github.com/repos/${REPO}/releases?per_page=10")
  if [ -n "$releases_json" ]; then
    tag=$(extract_tag_owning_asset_from_releases_json "$releases_json" "$asset_name")
    if [ -n "${tag:-}" ]; then
      echo "$tag"
      return 0
    fi
    log "no release in the 10 most recent carries a ${asset_name} asset -- falling back to git ls-remote (asset-unverified)"
  else
    log "GitHub API release lookup failed -- falling back to git ls-remote (asset-unverified)"
  fi
  if command -v git >/dev/null 2>&1; then
    tag=$(git ls-remote --tags --refs "https://github.com/${REPO}.git" 2>/dev/null \
      | sed -n 's#.*refs/tags/##p' \
      | sort -t. -k1,1n -k2,2n -k3,3n \
      | tail -1)
  fi
  echo "${tag:-}"
}

fetch() {
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  else
    wget -qO "$dest" "$url"
  fi
}

resolve_latest_gm_tag() {
  token=$(github_token)
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$token" ]; then
      curl -fsSL -H "Authorization: Bearer $token" "https://api.github.com/repos/${GM_REPO}/releases/latest" 2>/dev/null | grep -o '"tag_name" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/'
    else
      curl -fsSL "https://api.github.com/repos/${GM_REPO}/releases/latest" 2>/dev/null | grep -o '"tag_name" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/'
    fi
  elif command -v wget >/dev/null 2>&1; then
    if [ -n "$token" ]; then
      wget -qO- --header="Authorization: Bearer $token" "https://api.github.com/repos/${GM_REPO}/releases/latest" 2>/dev/null | grep -o '"tag_name" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/'
    else
      wget -qO- "https://api.github.com/repos/${GM_REPO}/releases/latest" 2>/dev/null | grep -o '"tag_name" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/'
    fi
  fi
}

install_skill() {
  tag=$(resolve_latest_gm_tag)
  if [ -z "$tag" ]; then
    log "FATAL: could not resolve latest release tag for ${GM_REPO}"
    exit 1
  fi
  ver=$(echo "$tag" | sed 's/^v//')
  log "gm-skill: resolved latest release ${tag}"

  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT

  base="https://github.com/${GM_REPO}/releases/download/${tag}"
  asset="gm-skill-${ver}.tar.gz"
  fetch "${base}/${asset}" "${work}/${asset}"
  fetch "${base}/${asset}.sha256" "${work}/${asset}.sha256"

  expected=$(awk '{print $1}' "${work}/${asset}.sha256")
  actual=$(sha256_file "${work}/${asset}")
  if [ -z "$expected" ] || [ "$(echo "$actual" | tr 'A-F' 'a-f')" != "$(echo "$expected" | tr 'A-F' 'a-f')" ]; then
    log "FATAL: sha256 mismatch for ${asset} (expected ${expected}, got ${actual})"
    exit 1
  fi

  mkdir -p "${work}/extract"
  tar -xzf "${work}/${asset}" -C "${work}/extract"

  mkdir -p "$CLAUDE_SKILLS_DIR"
  rm -rf "${CLAUDE_SKILLS_DIR}/gm"
  cp -R "${work}/extract/skills/gm" "${CLAUDE_SKILLS_DIR}/gm"
  log "installed gm skill ${tag} -> ${CLAUDE_SKILLS_DIR}/gm"
}

# The gm MCP server must start from a LOCAL file, never `npx -y github:...`.
# An npx github spec re-resolves the git ref over the network and reinstalls on
# every single (re)connect -- measured 9.1s on an idle machine against 0.75s for
# the same bundle launched locally. An MCP host allows 30s for the whole connect
# handshake, so on a machine under real load (several concurrent gm sessions, the
# runner's wasm pools resident) that network path blows the budget and the host
# reports CONNECT_TIMEOUT. The session then loses the gm tool for the rest of its
# life and falls back to hand-writing spool files. Vendoring the bundle here
# makes connect a plain local `node` start that reaches no network at all.

# Current gm.wasm imports env:host_plugin_call. The retired JS wasm host
# never registered that import, so any boot that still spawned
# plugkit-wasm-wrapper.js died with LinkError and self-healed into a
# restart loop. agentplug-runner already provides the import. Quarantine
# leftover wrapper files so that path cannot be re-entered.
quarantine_retired_js_host() {
  retired_dir="${GM_TOOLS_DIR}/retired-js-host"
  moved=0
  for name in plugkit-wasm-wrapper.js supervisor.js bootstrap.js; do
    src="${GM_TOOLS_DIR}/${name}"
    if [ -f "$src" ]; then
      if [ "$moved" -eq 0 ]; then
        mkdir -p "$retired_dir"
        moved=1
      fi
      mv -f "$src" "${retired_dir}/${name}"
      log "quarantined retired JS host file ${name} -> ${retired_dir} (cannot link env:host_plugin_call)"
    fi
  done
  wrapper_dir="${GM_TOOLS_DIR}/wrapper"
  if [ -d "$wrapper_dir" ]; then
    if [ "$moved" -eq 0 ]; then
      mkdir -p "$retired_dir"
    fi
    rm -rf "${retired_dir}/wrapper"
    mv -f "$wrapper_dir" "${retired_dir}/wrapper"
    log "quarantined retired JS host directory wrapper -> ${retired_dir}"
  fi
}

install_mcp_server() {
  mkdir -p "$GM_TOOLS_DIR"
  dest="${GM_TOOLS_DIR}/gm-mcp-server.js"
  tmp="${dest}.tmp.$$"
  url="https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js"
  if fetch "$url" "$tmp"; then
    mv -f "$tmp" "$dest"
    log "installed gm-mcp server -> ${dest}"
    log "register it (once) with:"
    log "  claude mcp remove gm 2>/dev/null; claude mcp add gm -- node \"${dest}\""
  else
    rm -f "$tmp"
    log "WARN: could not download the gm-mcp server bundle -- the spool protocol still works without it"
  fi
}

main() {
  if [ "${1:-}" = "install" ]; then
    install_skill
    install_mcp_server
    quarantine_retired_js_host
    exit 0
  fi

  asset=$(detect_asset)
  if [ -z "$asset" ]; then
    log "FATAL: no published agentplug-runner binary for platform=$(uname -s) arch=$(uname -m)"
    log "Request a build at https://github.com/${REPO}/issues"
    exit 1
  fi

  tag=$(resolve_installable_tag "$asset")
  if [ -z "$tag" ]; then
    log "FATAL: no release of ${REPO} (checked the 10 most recent) carries a ${asset} asset"
    exit 1
  fi
  log "agentplug-runner: resolved installable release ${tag}"

  mkdir -p "$GM_TOOLS_DIR"
  base="https://github.com/${REPO}/releases/download/${tag}"
  case "$asset" in
    *.exe) dest="${GM_TOOLS_DIR}/agentplug-runner.exe" ;;
    *) dest="${GM_TOOLS_DIR}/agentplug-runner" ;;
  esac
  tmp="${dest}.tmp.$$"
  shafile="${dest}.sha256.tmp.$$"

  log "downloading ${base}/${asset}"
  fetch "${base}/${asset}" "$tmp"
  fetch "${base}/${asset}.sha256" "$shafile"

  expected=$(awk '{print $1}' "$shafile")
  actual=$(sha256_file "$tmp")
  if [ -z "$expected" ] || [ "$(echo "$actual" | tr 'A-F' 'a-f')" != "$(echo "$expected" | tr 'A-F' 'a-f')" ]; then
    log "FATAL: sha256 mismatch for ${asset} (expected ${expected}, got ${actual})"
    rm -f "$tmp" "$shafile"
    exit 1
  fi
  rm -f "$shafile"
  chmod 755 "$tmp"
  if ! mv -f "$tmp" "$dest" 2>/dev/null; then
    if rm -f "$dest" 2>/dev/null && mv -f "$tmp" "$dest" 2>/dev/null; then
      : # unlinked running binary and placed new binary at dest
    else
      staged="${dest}.new"
      mv -f "$tmp" "$staged"
      log "agentplug-runner is currently running and locked; staged update at ${staged}"
      if [ ! -f "$dest" ]; then
        log "FATAL: no existing agentplug-runner at ${dest} to fall back to"
        exit 1
      fi
    fi
  fi
  printf '%s' "$tag" > "${GM_TOOLS_DIR}/agentplug-runner.version"
  log "installed agentplug-runner ${tag} -> ${dest}"

  quarantine_retired_js_host

  exec "$dest" "$@"
}

main "$@"
