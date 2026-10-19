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
  local pending wf ok
  GATE_REASON=""
  ok=$(gh api "repos/AnEntrypoint/$1/actions/runs?head_sha=$2&per_page=100" --jq '[.workflow_runs[] | select(.conclusion == "success")] | length') || { echo "::error::run query failed for $1 at ${2:0:9}"; return 1; }
  if [ "$ok" = "0" ]; then
    GATE_REASON="no successful CI run for this sha"
    return 1
  fi
  pending=$(gh api "repos/AnEntrypoint/$1/actions/runs?head_sha=$2&per_page=100" --jq '[.workflow_runs[] | select(.name != "Deploy GH Pages") | select(.name | test("release|publish|build|wasm"; "i"))] as $m | if ($m | length) == 0 then "none" else ([$m[] | select(.status != "completed" or ((.conclusion // "") | IN("success", "skipped", "neutral") | not))] | length | tostring) end') || { echo "::error::gate query failed for $1 at ${2:0:9}"; return 1; }
  if [ "$pending" = "none" ]; then
    wf=$(gh api "repos/AnEntrypoint/$1/actions/workflows" --jq '[.workflows[] | select(.name | test("release|publish|build|wasm"; "i"))] | length') || { echo "::error::workflow query failed for $1"; return 1; }
    [ "$wf" = "0" ]
    return
  fi
  [ "$pending" = "0" ]
}

stage_pins() {
  local path repo sha cur
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
    if ! gate_ok "$repo" "$sha"; then
      echo "held $path@${sha:0:9}: ${GATE_REASON:-a release-path run for it is not green}"
      continue
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

  message="pins: advance $STAGED submodule pin(s) to their main [skip ci]"
  body="${BODY}bump-pins run $witness, attempt $attempt"
  git commit -q -m "$message" -m "$body" || exit 1

  if ! bash scripts/triage/check-pins.sh; then
    echo "::error::check-pins failed on the candidate; nothing published"
    git reset -q --hard origin/main
    exit 1
  fi

  if git push -q origin HEAD:main; then
    echo "published $(git rev-parse --short HEAD) on attempt $attempt"
    gh workflow run doc-drift.yml --ref main || echo "::warning::doc-drift dispatch failed; the advanced pins have no doc-drift witness"
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
