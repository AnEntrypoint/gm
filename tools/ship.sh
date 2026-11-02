#!/usr/bin/env bash
# Gate, then commit and push only the named paths, and only when the gate's own exit code is zero. Usage: ship.sh "<subject>" <paths...>
set -o pipefail
cd /workspace/gm-new || exit 1
msg="$1"
shift
out=/tmp/gm-scratch/gm-new/audit/gate.out
node -e "import('./src/gate.mjs').then(async (m) => { const r = await m.runGate(process.cwd()); console.log(JSON.stringify({ gate: r.ok, failed: r.failed })); process.exit(r.ok ? 0 : 1); })" > "$out" 2>&1
rc=$?
tail -n 1 "$out"
echo "gate exit code: $rc"
if [ "$rc" -ne 0 ]; then
  echo "NOT COMMITTED: the gate failed"
  exit 1
fi
git add -- "$@" && git commit -q -m "$msg" -- "$@" && git push -q origin main && echo "COMMITTED $(git rev-parse HEAD) and pushed; gate exit code $rc"
