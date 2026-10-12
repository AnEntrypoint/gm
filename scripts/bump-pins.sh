#!/usr/bin/env bash
# Advance each submodule pin to the tip of its target's main, then publish the
# result to main. Usage: bump-pins.sh   (run from the gm root, with origin
# pushable by the environment's credentials).
#
# Each attempt resets to origin/main, stages every gate-cleared target at its
# remote main tip, commits, runs check-pins.sh on the candidate, and pushes.
# A rejected push (another writer moved main) is recovered by recomputing on the
# new base, not by skipping: the pins are re-resolved from current remote tips.
#
# Output: "published <sha>", or "already current <sha>". Exit 0 for either;
# exit 1 when a remote cannot be read, check-pins fails, or the retry budget runs out.
# Env: PIN_REMOTE_BASE (default https://github.com/AnEntrypoint), PIN_RETRIES (default 6),
#      GITHUB_RUN_ID (recorded in the commit body as the witness).
set -uo pipefail

base="${PIN_REMOTE_BASE:-https://github.com/AnEntrypoint}"
retries="${PIN_RETRIES:-6}"
witness="${GITHUB_RUN_ID:-local}"
targets="rs-plugkit rs-codeinsight rs-search agentplug agentplug-bert agentplug-crux agentplug-libsql agentplug-treesitter gm-config gm-mcp vendor/tencentdb-agent-memory"

repo_of() {
  case "$1" in
    vendor/tencentdb-agent-memory) echo agent-memory ;;
    *) echo "$1" ;;
  esac
}

# A target is gated when its remote tip has a release-path run that is not green.
# A gate that cannot be read holds the target; it never passes by default.
gate_ok() {
  local pending
  pending=$(gh api "repos/AnEntrypoint/$1/actions/runs?head_sha=$2&per_page=100" --jq '[.workflow_runs[] | select(.name != "Deploy GH Pages") | select(.name | test("release|publish|build|wasm"; "i")) | select(.status != "completed" or ((.conclusion // "") | IN("success", "skipped", "neutral") | not))] | length') || return 1
  [ "$pending" = "0" ]
}

# Stage the gate-cleared targets whose gitlink differs from their remote main tip.
# Sets STAGED to the number staged and BODY to one line per change.
stage_pins() {
  local path repo sha cur
  STAGED=0
  BODY=""
  for path in $targets; do
    repo=$(repo_of "$path")
    sha=$(git ls-remote "$base/$repo.git" refs/heads/main | awk '{print $1}')
    if [ -z "$sha" ]; then
      echo "::error::no main for $path at $base"
      return 1
    fi
    if ! gate_ok "$repo" "$sha"; then
      echo "held $path@${sha:0:9}: a release-path run for it is not green"
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
