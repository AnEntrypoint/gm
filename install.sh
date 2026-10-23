#!/bin/sh
set -eu

REPO="AnEntrypoint/agentplug-bin"
GM_REPO="AnEntrypoint/gm"
GM_TOOLS_DIR="${HOME}/.gm-tools"
CLAUDE_SKILLS_DIR="${HOME}/.claude/skills"
AGENTS_SKILLS_DIR="${HOME}/.agents/skills"
SKILL_MODE_LEDGER=".gm-skill-install-modes"
SKILL_PRELINK_DIR=".gm-skill-prelink"

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
        aarch64|arm64) echo "agentplug-runner-windows-arm64.exe" ;;
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
  releases_json=$(fetch_json "https://api.github.com/repos/${REPO}/releases/latest")
  if [ -z "$releases_json" ]; then
    log "GitHub API release lookup for ${REPO} failed; refusing to install an older or unverified release"
    return 0
  fi
  if ! printf '%s' "$releases_json" | tr ',' '\n' | awk -v needle="\"name\": \"${asset_name}\"" 'index($0, needle) > 0 { found = 1 } END { exit !found }'; then
    log "the latest release of ${REPO} carries no ${asset_name} asset; refusing to install an older release"
    return 0
  fi
  extract_tag_owning_asset_from_releases_json "$releases_json" "$asset_name"
}

fetch() (
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  else
    wget -qO "$dest" "$url"
  fi
)

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

skill_install_roots() {
  printf '%s\n' "$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR"
}

skill_source_dir() {
  override="${GM_SKILL_SOURCE_DIR:-}"
  if [ -n "$override" ] && [ -f "${override}/gm/SKILL.md" ]; then
    printf '%s\n' "$override"
    return 0
  fi
  here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || here=""
  if [ -n "$here" ] && [ -f "${here}/skills/gm/SKILL.md" ]; then
    printf '%s\n' "${here}/skills"
    return 0
  fi
  return 1
}

link_skill_dir() {
  src="$1"
  dest="$2"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      if command -v cmd >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
        wsrc=$(cygpath -w "$src")
        wdst=$(cygpath -w "$dest")
        MSYS_NO_PATHCONV=1 cmd /c mklink /J "$wdst" "$wsrc" >/dev/null 2>&1 && return 0
      fi
      return 1
      ;;
  esac
  ln -s "$src" "$dest" 2>/dev/null
}

record_skill_mode() {
  root="$1"; name="$2"; mode="$3"; src="$4"
  file="${root}/${SKILL_MODE_LEDGER}"
  tmp="${file}.tmp.$$"
  {
    printf '# gm skill install modes: <name> <linked|copied|refused> <iso-ts> <source>\n'
    if [ -f "$file" ]; then
      while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|\#*) continue ;; esac
        case "$line" in "${name} "*) continue ;; esac
        printf '%s\n' "$line"
      done < "$file"
    fi
    printf '%s %s %s %s\n' "$name" "$mode" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$src"
  } > "$tmp"
  mv -f "$tmp" "$file"
}

resolve_skill_dir() {
  (cd "$1" 2>/dev/null && pwd -P) || printf '%s' "$1"
}

# Clears the way for a copy install. A displaced directory is parked under the
# dotted prelink dir, never deleted; deletion needs GM_SKILL_LINK_FORCE=1.
clear_release_target() {
  root="$1"; name="$2"; dest="${root}/${name}"
  if [ -L "$dest" ]; then
    rm -f "$dest"
    return 0
  fi
  if [ -d "$dest" ]; then
    park="${root}/${SKILL_PRELINK_DIR}"
    mkdir -p "$park"
    aside="${park}/${name}-$(date +%s)"
    if mv "$dest" "$aside" 2>/dev/null; then
      log "parked displaced ${name} at ${aside}"
      return 0
    fi
    if [ "${GM_SKILL_LINK_FORCE:-0}" = "1" ]; then
      rm -rf "$dest"
      return 0
    fi
    log "REFUSED ${name} -> ${dest}: could not park the existing install; rerun with GM_SKILL_LINK_FORCE=1 to replace it"
    return 1
  fi
  [ -e "$dest" ] && rm -f "$dest"
  return 0
}

install_one_skill() {
  src="$1"; name="$2"; root="$3"
  dest="${root}/${name}"
  mkdir -p "$root"
  if [ -L "$dest" ]; then
    current=$(resolve_skill_dir "$dest")
    wanted=$(resolve_skill_dir "$src")
    if [ -n "$current" ] && [ "$current" = "$wanted" ]; then
      record_skill_mode "$root" "$name" linked "$src"
      log "linked ${name} -> ${dest} => ${src} (already the source directory)"
      return 0
    fi
    rm -f "$dest"
  elif [ -d "$dest" ]; then
    park="${root}/${SKILL_PRELINK_DIR}"
    mkdir -p "$park"
    aside="${park}/${name}-$(date +%s)"
    if ! mv "$dest" "$aside" 2>/dev/null; then
      if [ "${GM_SKILL_LINK_FORCE:-0}" = "1" ]; then
        rm -rf "$dest"
      else
        record_skill_mode "$root" "$name" refused "$src"
        log "REFUSED ${name} -> ${dest}: could not move the existing install aside; it stays a COPY and will drift from ${src} -- rerun with GM_SKILL_LINK_FORCE=1 to replace it"
        return 0
      fi
    fi
  elif [ -e "$dest" ]; then
    rm -f "$dest"
  fi
  if link_skill_dir "$src" "$dest"; then
    record_skill_mode "$root" "$name" linked "$src"
    log "linked ${name} -> ${dest} => ${src} (edits to the source are served immediately)"
    return 0
  fi
  cp -R "$src" "$dest"
  record_skill_mode "$root" "$name" copied "$src"
  log "WARNING: ${name} -> ${dest} is a COPY (no junction/symlink available here); it is NOT the file at ${src} and will drift silently -- recorded in ${root}/${SKILL_MODE_LEDGER}"
}

check_installed_skills() {
  srcdir="$1"
  bad=0
  for root in $(skill_install_roots); do
    for skill_dir in "${srcdir}"/*/; do
      [ -f "${skill_dir}SKILL.md" ] || continue
      name=$(basename "$skill_dir")
      [ -f "${root}/${name}/SKILL.md" ] || continue
      if [ "$(sha256_file "${skill_dir}SKILL.md")" != "$(sha256_file "${root}/${name}/SKILL.md")" ]; then
        log "DRIFT ${name} at ${root}/${name}/SKILL.md: contents differ from ${skill_dir}SKILL.md"
        bad=1
        continue
      fi
      if [ ! -L "${root}/${name}" ]; then
        log "DRIFT ${name} at ${root}/${name}/SKILL.md: contents match but it is a SEPARATE file, so the next source edit will not reach it"
        bad=1
      fi
    done
  done
  if [ "$bad" -eq 0 ]; then
    log "skill check: every installed skill is the source file"
  fi
}

install_skill() {
  srcdir=$(skill_source_dir) || srcdir=""
  if [ -n "$srcdir" ]; then
    log "gm-skill source: ${srcdir} -- installing from the checkout, not a release tarball"
    for root in $(skill_install_roots); do
      for skill_dir in "${srcdir}"/*/; do
        [ -f "${skill_dir}SKILL.md" ] || continue
        install_one_skill "${skill_dir%/}" "$(basename "$skill_dir")" "$root"
      done
    done
    check_installed_skills "$srcdir"
    return 0
  fi

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
  # Both files are fetched at once: they are two round trips on one host, and measured
  # cold they cost ~530 ms each, so serialising them adds a full handshake to the install.
  fetch "${base}/${asset}" "${work}/${asset}" &
  fetch_asset=$!
  fetch "${base}/${asset}.sha256" "${work}/${asset}.sha256" &
  fetch_sum=$!
  wait "$fetch_asset" || { log "FATAL: download of ${asset} failed"; exit 1; }
  wait "$fetch_sum" || { log "FATAL: download of ${asset}.sha256 failed"; exit 1; }

  expected=$(awk '{print $1}' "${work}/${asset}.sha256")
  actual=$(sha256_file "${work}/${asset}")
  if [ -z "$expected" ] || [ "$(echo "$actual" | tr 'A-F' 'a-f')" != "$(echo "$expected" | tr 'A-F' 'a-f')" ]; then
    log "FATAL: sha256 mismatch for ${asset} (expected ${expected}, got ${actual})"
    exit 1
  fi

  mkdir -p "${work}/extract"
  tar -xzf "${work}/${asset}" -C "${work}/extract"

  for root in $(skill_install_roots); do
    mkdir -p "$root"
    for skill_dir in "${work}/extract/skills"/*/; do
      skill_name="$(basename "$skill_dir")"
      [ -f "${skill_dir}SKILL.md" ] || continue
      if ! clear_release_target "$root" "$skill_name"; then
        record_skill_mode "$root" "$skill_name" refused "release:${tag}"
        continue
      fi
      cp -R "$skill_dir" "${root}/${skill_name}"
      record_skill_mode "$root" "$skill_name" copied "release:${tag}"
      log "WARNING: ${skill_name} -> ${root}/${skill_name} is a COPY with no local source beside this installer; it will not track a checkout -- set GM_SKILL_SOURCE_DIR (or run from a gm checkout) to install it as a link"
    done
    install_skill_assets "${work}/extract" "$root"
  done
}

install_skill_assets() {
  src="$1"
  dest="$2"
  manifest="${src}/skills/skill-assets.txt"
  if [ ! -f "$manifest" ]; then
    log "WARN: no skill asset manifest at ${manifest}"
    return 0
  fi
  while IFS= read -r rel || [ -n "$rel" ]; do
    case "$rel" in ''|\#*) continue ;; esac
    src_file="${src}/skills/${rel}"
    dest_file="${dest}/${rel}"
    if [ ! -f "$src_file" ]; then
      log "WARN: skill asset absent at ${src_file}"
      continue
    fi
    mkdir -p "$(dirname "$dest_file")"
    cp -f "$src_file" "$dest_file"
    log "installed skill asset ${rel} -> ${dest_file}"
  done < "$manifest"
}

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
  dest="${GM_TOOLS_DIR}/gm-mcp-server.mjs"
  tmp="${dest}.tmp.$$"
  url="https://raw.githubusercontent.com/AnEntrypoint/gm-mcp/main/bin/gm-mcp-server.js"
  if fetch "$url" "$tmp"; then
    mv -f "$tmp" "$dest"
    log "installed gm-mcp server -> ${dest}"
    log "start the HTTP server and register Claude Code over it (once):"
    log "  node \"${dest}\" ensure-http"
    log "  claude mcp remove gm -s user 2>/dev/null; claude mcp add --transport http gm http://127.0.0.1:8787/mcp -s user"
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
  # Two round trips on one host, run together rather than one after the other.
  fetch "${base}/${asset}" "$tmp" &
  fetch_asset=$!
  fetch "${base}/${asset}.sha256" "$shafile" &
  fetch_sum=$!
  wait "$fetch_asset" || { log "FATAL: download of ${asset} failed"; exit 1; }
  wait "$fetch_sum" || { log "FATAL: download of ${asset}.sha256 failed"; exit 1; }

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

  exec "$dest" "$@"
}

main "$@"
