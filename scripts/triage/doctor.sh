#!/usr/bin/env bash
# One call for the whole picture: watcher health, submodule pins, and the latest failed CI run of each
# release-facing repo. Usage: doctor.sh   (run from the gm root). Exit 1 if any check fails.
here=$(cd "$(dirname "$0")" && pwd)
rc=0
echo "== watcher"; "$here/runner-status.sh" "$PWD" || rc=1
echo "== submodule pins"; "$here/check-pins.sh" | grep -v "^ok" || echo "all pins published"
[ "${PIPESTATUS[0]}" = 0 ] || rc=1
echo "== latest failed CI runs"
for repo in AnEntrypoint/agentplug-crux AnEntrypoint/agentplug AnEntrypoint/gm-mcp AnEntrypoint/rs-plugkit; do
  run=$(gh run list -R "$repo" --status failure --limit 1 --json databaseId,name,createdAt -q 'if length > 0 then .[0] | "\(.databaseId) \(.name) \(.createdAt)" else empty end' 2>/dev/null)
  if [ -n "$run" ]; then set -- $run; echo "$repo run $1 ($2 $3)"; else echo "$repo no failed runs"; fi
done
exit $rc
