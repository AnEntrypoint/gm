#!/usr/bin/env bash
# One call for the whole picture: watcher health, submodule pins, and the CI state of each
# release-facing repo on main. Usage: doctor.sh   (run from the gm root). Exit 1 if the watcher
# is dead or a pin is unpublished. A repo is RED only when the newest run of a workflow on main
# failed; an older failure that a later run fixed is not reported.
here=$(cd "$(dirname "$0")" && pwd)
rc=0
echo "== watcher"; "$here/runner-status.sh" "$PWD" || rc=1
echo "== submodule pins"; "$here/check-pins.sh" | grep -v "^ok" || echo "all pins published"
[ "${PIPESTATUS[0]}" = 0 ] || rc=1
echo "== CI on main (newest run of each workflow)"
for repo in AnEntrypoint/agentplug-crux AnEntrypoint/agentplug AnEntrypoint/gm-mcp AnEntrypoint/rs-plugkit; do
  gh run list -R "$repo" --branch main --status completed --limit 100 --json databaseId,name,workflowDatabaseId,conclusion,createdAt 2>/dev/null | python3 -c '
import json, sys
repo = sys.argv[1]
runs = json.load(sys.stdin)
newest = {}
for run in sorted(runs, key=lambda r: r["createdAt"], reverse=True):
    newest.setdefault(run["workflowDatabaseId"], run)
red = [r for r in newest.values() if r["conclusion"] in ("failure", "timed_out", "startup_failure")]
if not runs:
    print(repo, "no completed runs on main")
elif not red:
    print(repo, "green: newest run of", len(newest), "workflow(s) passed")
for r in red:
    print(repo, "RED run", r["databaseId"], "(" + r["name"], r["conclusion"] + ",", r["createdAt"] + ")")
' "$repo" || echo "$repo CI query failed"
done
exit $rc
