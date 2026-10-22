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
  gate_rows=$(awk -F'\t' 'tolower($1) ~ /release|publish|build|wasm|bundle/' <<<"$rows")
  if [ -z "$gate_rows" ]; then
    wf=$(gh api "repos/AnEntrypoint/$1/actions/workflows" --jq '[.workflows[] | select(.name | test("release|publish|build|wasm|bundle"; "i"))] | length') || { echo "::error::workflow query failed for $1" >&2; return 2; }
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
  # Returns 0 once every run recorded for the sha has completed, 1 while it is still
  # not decidable. A sha with no run gets one grace poll and nothing more: a tip whose
  # path filters skipped CI never gains a run, and measured on run 39725854148 that
  # spin cost 615 s of a 641 s run and was held anyway.
  local runs total active polled=0
  while :; do
    runs=$(gh api --paginate "repos/AnEntrypoint/$1/actions/runs?head_sha=$2&per_page=100" --jq '.workflow_runs[] | select(.name != "Deploy GH Pages") | .status' | awk 'NF {n++; if ($0 != "completed") a++} END{print n+0, a+0}') || return 2
    read -r total active <<<"$runs"
    [ "$total" -gt 0 ] && [ "$active" = "0" ] && return 0
    if [ "$total" = "0" ]; then
      [ "$polled" = "1" ] && return 1
      [ "$(date +%s)" -ge "$wait_deadline" ] && return 1
      polled=1
      sleep "${BUMP_APPEAR_SECONDS:-20}"
      continue
    fi
    [ "$(date +%s)" -ge "$wait_deadline" ] && return 1
    sleep "${BUMP_POLL_SECONDS:-20}"
  done
}

# One submodule's network probe, run as a background job. Writes a TSV verdict to $2:
#   path <tab> state <tab> sha <tab> message
# state is pin, hold or error; sha is the commit to pin, or "-" when unknown.
probe_path() {
  local path=$1 out=$2
  local repo sha tip reason rc cand
  repo=$(repo_of "$path") || { printf '%s\terror\t-\tno .gitmodules url for %s\n' "$path" "$path" >"$out"; return 0; }
  sha=$(git ls-remote "$base/$repo.git" refs/heads/main | awk '{print $1}')
  if [ -z "$sha" ]; then
    printf '%s\terror\t-\tno main for %s at %s\n' "$path" "$path" "$base" >"$out"
    return 0
  fi
  tip=$sha
  gate_ok "$repo" "$tip"; rc=$?
  if [ "$rc" = "2" ]; then
    printf '%s\terror\t-\tgate query failed for %s; %s cannot be judged at %s\n' "$path" "$repo" "$path" "${tip:0:9}" >"$out"
    return 0
  fi
  if [ "$rc" = "1" ]; then
    wait_for_tip "$repo" "$tip"; rc=$?
    if [ "$rc" = "2" ]; then
      printf '%s\terror\t-\trun query failed for %s while waiting on %s\n' "$path" "$repo" "${tip:0:9}" >"$out"
      return 0
    fi
    gate_ok "$repo" "$tip"; rc=$?
    if [ "$rc" = "2" ]; then
      printf '%s\terror\t-\tgate query failed for %s; %s cannot be judged at %s\n' "$path" "$repo" "$path" "${tip:0:9}" >"$out"
      return 0
    fi
  fi
  if [ "$rc" != "0" ]; then
    reason=${GATE_REASON:-a release-path run for it is not green}
    cand=$(newest_green "$repo" "$tip"); rc=$?
    if [ "$rc" = "2" ]; then
      printf '%s\terror\t-\tcandidate query failed for %s; %s held at %s cannot be re-pinned\n' "$path" "$repo" "$path" "${tip:0:9}" >"$out"
      return 0
    fi
    if [ "$rc" != "0" ]; then
      printf '%s\thold\t-\theld %s@%s: %s\n' "$path" "$path" "${tip:0:9}" "$reason" >"$out"
      return 0
    fi
    sha=$cand
    printf '%s\tpin\t%s\ttip %s held (%s); pinning newest green main commit %s\n' "$path" "$sha" "${tip:0:9}" "$reason" "${sha:0:9}" >"$out"
  fi
  if [ "$repo" = "gm-mcp" ] && ! node scripts/triage/gm-mcp-bin-fresh.mjs "$repo" "$sha"; then
    printf '%s\thold\t-\theld %s@%s: its bin is not a fresh build of its src; previous pin kept\n' "$path" "$path" "${sha:0:9}" >"$out"
    return 0
  fi
  [ -s "$out" ] || printf '%s\tpin\t%s\t-\n' "$path" "$sha" >"$out"
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
  local targets path i rc cur running=0
  local res_path res_state res_sha res_msg
  wait_deadline=$(( $(date +%s) + ${BUMP_WAIT_SECONDS:-600} ))
  STAGED=0
  BODY=""
  targets=$(git config -f .gitmodules --get-regexp '^submodule\..*\.path$' | awk '{print $2}')
  [ -n "$targets" ] || { echo "::error::no submodule paths in .gitmodules"; return 1; }

  # Every probe is independent network work until `git update-index` writes the index,
  # so the probes run with a bounded fan-out and the index writes stay serial and in
  # .gitmodules order. Fan-out stays small so the gh api burst keeps clear of
  # secondary rate limits, which would turn a probe into an error and fail the run.
  probe_dir=$(mktemp -d) || { echo "::error::cannot create a probe dir"; return 1; }
  i=0
  for path in $targets; do
    i=$((i + 1))
    probe_path "$path" "$probe_dir/$i" &
    running=$((running + 1))
    if [ "$running" -ge "${BUMP_PARALLEL:-4}" ]; then
      wait -n
      running=$((running - 1))
    fi
  done
  wait

  rc=0
  i=0
  for path in $targets; do
    i=$((i + 1))
    IFS=$'\t' read -r res_path res_state res_sha res_msg <"$probe_dir/$i"
    case "$res_state" in
      error)
        echo "::error::$res_msg" >&2
        rc=1
        ;;
      hold)
        echo "$res_msg"
        ;;
      pin)
        [ "$res_msg" = "-" ] || echo "$res_msg"
        cur=$(git ls-tree HEAD -- "$path" | awk '{print $3}')
        if [ "$cur" != "$res_sha" ]; then
          if git update-index --cacheinfo "160000,$res_sha,$path"; then
            STAGED=$((STAGED + 1))
            BODY="$BODY$path ${cur:0:9} -> ${res_sha:0:9}"$'\n'
          else
            rc=1
          fi
        fi
        ;;
    esac
  done
  rm -rf "$probe_dir"
  return $rc
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
