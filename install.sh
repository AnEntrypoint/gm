#!/bin/sh
set -eu

# Run from a checked-out/package copy: piped scripts cannot supply bundled skills.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -f "$SCRIPT_DIR/bin/gm-install.js" ]; then
  echo "Use a local SolutionsAsService/gm checkout/package (bundled Node installer missing)." >&2
  exit 1
fi
if [ "${1:-}" = "--with-runtime" ] && [ "${2:-}" = "--runner-only" ]; then
  shift 2
  if [ "$#" -ne 1 ] || [ "$1" != "spool" ]; then
    echo "Internal runner path accepts only spool; use the Node CLI for help/dry-run." >&2
    exit 1
  fi
else
  exec node "$SCRIPT_DIR/bin/gm-install.js" "$@"
fi
# Internal legacy runtime path only; Node gives this whole process a 120s deadline.
# Direct invocation also requires a portable timeout command; never run unbounded.
if ! command -v timeout >/dev/null 2>&1; then
  echo "Legacy runtime requires timeout (GNU coreutils); default skills install does not." >&2
  exit 1
fi

REPO="AnEntrypoint/agentplug-bin"
GM_TOOLS_DIR="${HOME}/.gm-tools"

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
      curl --connect-timeout 10 --max-time 30 -fsSL -H "Authorization: Bearer $token" "$url" 2>/dev/null
    else
      curl --connect-timeout 10 --max-time 30 -fsSL "$url" 2>/dev/null
    fi
  elif command -v wget >/dev/null 2>&1; then
    if [ -n "$token" ]; then
      wget --timeout=30 --tries=1 -qO- --header="Authorization: Bearer $token" "$url" 2>/dev/null
    else
      wget --timeout=30 --tries=1 -qO- "$url" 2>/dev/null
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
  releases_json=$(fetch_json "https://api.github.com/repos/${REPO}/releases?per_page=10") || exit 1
  extract_tag_owning_asset_from_releases_json "$releases_json" "$asset_name"
}

fetch() (
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --connect-timeout 10 --max-time 30 -fsSL "$url" -o "$dest"
  else
    wget --timeout=30 --tries=1 -qO "$dest" "$url"
  fi
)

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

main() {
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
      :
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

  exec timeout -k 5 120 "$dest" "$@"
}

main "$@"
