#!/usr/bin/env bash
set -uo pipefail

base="${PIN_REMOTE_BASE:-https://github.com/AnEntrypoint}"
retries="${PIN_RETRIES:-6}"
witness="${GITHUB_RUN_ID:-local}"

repo_of() {
  local name url
  name=$(git config -f .gitmodules --get-regexp '^submodule\..*\.path$' | awk -v p="$1" '$2 == p {sub(/^submodule\./, "", $1); sub(/\.path$/, "", $1); print $1}')
  url=$(git config -f .gitmodules --get "submodule.$name.url") || return 1
  url=${url%/}
  url=${url%.git}
  echo "${url##*/}"
}

gate_ok() {
  local rows gate_rows open wf ok
  GATE_REASON=""
  rows=$(gh api --paginate "repos/AnEntrypoint/$1/actions/runs?head_sha=$2&per_page=100" --jq '.workflow_runs[] | select(.name != "Deploy GH Pages") | [.name, .status, (.conclusion // "")] | @tsv') || { echo "::error::run query failed for $1 at ${2:0:9}" >&2; return 2; }
  if [ -z "$rows" ]; then
    GATE_REASON="no CI run exists for this sha (no workflow triggered for it; path filters skip docs-only tips)"
    return 1
  fi
  ok=$(awk -F'\t' '$3 == "success" {n++} END{print n+0}' <<<"$rows")
  if [ "$ok" = "0" ]; then
    GATE_REASON="no successful CI run for this sha"
    return 1
  fi
  gate_rows=$(awk -F'\t' 'tolower($1) ~ /release|publish|build|wasm/' <<<"$rows")
  if [ -z "$gate_rows" ]; then
    wf=$(gh api "repos/AnEntrypoint/$1/actions/workflows" --jq '[.workflows[] | select(.name | test("release|publish|build|wasm"; "i"))] | length') || { echo "::error::workflow query failed for $1" >&2; return 2; }
    if [ "$wf" = "0" ]; then
      return 0
    fi
    GATE_REASON="no release-path run exists for this sha (its release workflow did not trigger for it)"
    return 1
  fi
  open=$(awk -F'\t' '$2 != "completed" || ($3 != "success" && $3 != "skipped" && $3 != "neutral") {n++} END{print n+0}' <<<"$gate_rows")
  [ "$open" = "0" ]
}

wait_for_tip() {
  local runs total active
  while :; do
    runs=$(gh api --paginate "repos/AnEntrypoint/$1/actions/runs?head_sha=$2&per_page=100" --jq '.workflow_runs[] | select(.name != "Deploy GH Pages") | .status' | awk 'NF {n++; if ($0 != "completed") a++} END{print n+0, a+0}') || return 2
    read -r total active <<<"$runs"
    [ "$total" -gt 0 ] && [ "$active" = "0" ] && return 0
    [ "$(date +%s)" -ge "$wait_deadline" ] && return 1
    sleep 20
  done
}

newest_green() {
  local candidate listing rc
  listing=$(gh api "repos/AnEntrypoint/$1/commits?sha=main&per_page=6" --jq '.[].sha') || { echo "::error::commit listing query failed for $1" >&2; return 2; }
  for candidate in $listing; do
    [ "$candidate" = "$2" ] && continue
    gate_ok "$1" "$candidate"; rc=$?
    [ "$rc" = "2" ] && return 2
    if [ "$rc" = "0" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

stage_pins() {
  local path repo sha tip reason cur rc
  wait_deadline=$(( $(date +%s) + ${BUMP_WAIT_SECONDS:-600} ))
  STAGED=0
  BODY=""
  local targets
  targets=$(git config -f .gitmodules --get-regexp '^submodule\..*\.path$' | awk '{print $2}')
  [ -n "$targets" ] || { echo "::error::no submodule paths in .gitmodules"; return 1; }
  for path in $targets; do
    repo=$(repo_of "$path") || { echo "::error::no .gitmodules url for $path"; return 1; }
    sha=$(git ls-remote "$base/$repo.git" refs/heads/main | awk '{print $1}')
    if [ -z "$sha" ]; then
      echo "::error::no main for $path at $base"
      return 1
    fi
    tip=$sha
    gate_ok "$repo" "$tip"; rc=$?
    if [ "$rc" = "2" ]; then
      echo "::error::gate query failed for $repo; $path cannot be judged at ${tip:0:9}" >&2
      return 1
    fi
    if [ "$rc" = "1" ]; then
      wait_for_tip "$repo" "$tip"; rc=$?
      if [ "$rc" = "2" ]; then
        echo "::error::run query failed for $repo while waiting on ${tip:0:9}" >&2
        return 1
      fi
      gate_ok "$repo" "$tip"; rc=$?
      if [ "$rc" = "2" ]; then
        echo "::error::gate query failed for $repo; $path cannot be judged at ${tip:0:9}" >&2
        return 1
      fi
    fi
    if [ "$rc" != "0" ]; then
      reason=${GATE_REASON:-a release-path run for it is not green}
      sha=$(newest_green "$repo" "$tip"); rc=$?
      if [ "$rc" = "2" ]; then
        echo "::error::candidate query failed for $repo; $path held at ${tip:0:9} cannot be re-pinned" >&2
        return 1
      fi
      if [ "$rc" != "0" ]; then
        echo "held $path@${tip:0:9}: $reason"
        continue
      fi
      echo "tip ${tip:0:9} held ($reason); pinning newest green main commit ${sha:0:9}"
    fi
    cur=$(git ls-tree HEAD -- "$path" | awk '{print $3}')
    if [ "$cur" != "$sha" ]; then
      git update-index --cacheinfo "160000,$sha,$path" || return 1
      STAGED=$((STAGED + 1))
      BODY="$BODY$path ${cur:0:9} -> ${sha:0:9}"$'\n'
    fi
  done
}

attempt=0
while :; do
  attempt=$((attempt + 1))
  git fetch -q origin main || { echo "::error::fetch of origin main failed"; exit 1; }
  git reset -q --hard origin/main || exit 1

  stage_pins || exit 1
  if [ "$STAGED" = "0" ]; then
    echo "already current $(git rev-parse --short HEAD)"
    exit 0
  fi

  message="pins: advance $STAGED submodule pin(s) to their main"
  body="${BODY}bump-pins run $witness, attempt $attempt"
  git commit -q -m "$message" -m "$body" || exit 1

  if ! bash scripts/triage/check-pins.sh; then
    echo "::error::check-pins failed on the candidate; nothing published"
    git reset -q --hard origin/main
    exit 1
  fi

  if git push -q origin HEAD:main; then
    echo "published $(git rev-parse --short HEAD) on attempt $attempt"
    exit 0
  fi

  echo "push rejected on attempt $attempt (origin main moved); recomputing on the new base"
  if [ "$attempt" -ge "$retries" ]; then
    echo "::error::retry budget of $retries exhausted"
    git reset -q --hard origin/main
    exit 1
  fi
  sleep $((RANDOM % 5 + 2))
done
