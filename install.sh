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

resolve_latest_tag() {
  token=$(github_token)
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$token" ]; then
      tag=$(curl -fsSL -H "Authorization: Bearer $token" "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep -o '"tag_name" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    else
      tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep -o '"tag_name" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    fi
  elif command -v wget >/dev/null 2>&1; then
    if [ -n "$token" ]; then
      tag=$(wget -qO- --header="Authorization: Bearer $token" "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep -o '"tag_name" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    else
      tag=$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep -o '"tag_name" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    fi
  else
    log "FATAL: neither curl nor wget is available"
    exit 1
  fi
  if [ -z "${tag:-}" ] && command -v git >/dev/null 2>&1; then
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

main() {
  if [ "${1:-}" = "install" ]; then
    install_skill
    exit 0
  fi

  asset=$(detect_asset)
  if [ -z "$asset" ]; then
    log "FATAL: no published agentplug-runner binary for platform=$(uname -s) arch=$(uname -m)"
    log "Request a build at https://github.com/${REPO}/issues"
    exit 1
  fi

  tag=$(resolve_latest_tag)
  if [ -z "$tag" ]; then
    log "FATAL: could not resolve latest release tag for ${REPO}"
    exit 1
  fi
  log "agentplug-runner: resolved latest release ${tag}"

  mkdir -p "$GM_TOOLS_DIR"
  base="https://github.com/${REPO}/releases/download/${tag}"
  dest="${GM_TOOLS_DIR}/agentplug-runner"
  tmp="${dest}.tmp.$$"
  shafile="${tmp}.sha256"

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
  mv -f "$tmp" "$dest"
  printf '%s' "$tag" > "${GM_TOOLS_DIR}/agentplug-runner.version"
  log "installed agentplug-runner ${tag} -> ${dest}"

  exec "$dest" "$@"
}

main "$@"
