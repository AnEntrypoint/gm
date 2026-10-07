#!/usr/bin/env bash
# Print the failing step and its error lines of a GitHub Actions run, escape codes stripped.
# Usage: run-failure.sh <owner/repo> <run-id>
repo=$1; run=$2
[ -n "$repo" ] && [ -n "$run" ] || { echo "usage: run-failure.sh <owner/repo> <run-id>"; exit 2; }
gh run view "$run" -R "$repo" --json jobs -q '.jobs[] | select(.conclusion=="failure") | .name as $j | .databaseId as $id | (.steps[] | select(.conclusion=="failure") | "\($j) :: step \(.name) (job \($id))")'
for id in $(gh run view "$run" -R "$repo" --json jobs -q '.jobs[] | select(.conclusion=="failure") | .databaseId'); do
  gh api --allow-escape-sequences "repos/$repo/actions/jobs/$id/logs" 2>&1 | sed 's/\x1b\[[0-9;]*m//g; s/^[0-9T:.Z-]* //' \
    | grep -E "##\[error\]|HTTP [0-9]{3}|Error:|error(\[|:)|not found|denied|empty" | head -15
done
