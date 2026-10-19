#!/usr/bin/env bash
# Platform: POSIX shell only (calls the POSIX triage scripts). Run under Git Bash on Windows.
here=$(cd "$(dirname "$0")" && pwd)
rc=0
echo "== watcher"; "$here/runner-status.sh" "$PWD" || rc=1
echo "== submodule pins"; "$here/check-pins.sh" | grep -v "^ok" || echo "all pins published"
[ "${PIPESTATUS[0]}" = 0 ] || rc=1
echo "== repo hygiene (AGENTS.md budget, BOM, decorative glyphs)"; node "$here/../check-repo-hygiene.mjs" "$PWD" || rc=1
echo "== wasm build home (informational; build-wasm.sh falls back to OS temp directory homes)"
ch=${CARGO_HOME:-$HOME/.cargo}
if mkdir -p "$ch" 2>/dev/null && touch "$ch/.doctor-probe.$$" 2>/dev/null && rm -f "$ch/.doctor-probe.$$"; then echo "CARGO_HOME $ch writable"; else echo "CARGO_HOME $ch not writable: use scripts/triage/build-wasm.sh"; fi
rustup target list --installed 2>/dev/null | grep -qx wasm32-wasip1 && echo "wasm32-wasip1 installed" || echo "wasm32-wasip1 not installed under default RUSTUP_HOME: build-wasm.sh installs it"
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
