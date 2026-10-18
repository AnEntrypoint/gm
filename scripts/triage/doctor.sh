#!/usr/bin/env bash
here=$(cd "$(dirname "$0")" && pwd)
rc=0
echo "== watcher"; "$here/runner-status.sh" "$PWD" || rc=1
echo "== submodule pins"; "$here/check-pins.sh" | grep -v "^ok" || echo "all pins published"
[ "${PIPESTATUS[0]}" = 0 ] || rc=1
echo "== AGENTS.md size"; size=$(wc -c < "$PWD/AGENTS.md" | tr -d ' ')
if [ "$size" -ge 30000 ]; then echo "AGENTS.md $size bytes >= 30000: compile a fresh AGENTS.md (invariant 3)"; rc=1; else echo "AGENTS.md $size bytes"; fi
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
echo "== dream-rsi walking skeleton"; node "$here/dream-skeleton.mjs" --cwd "$PWD" >/dev/null && echo "skeleton PASS" || { echo "skeleton FAIL"; rc=1; }
exit $rc
