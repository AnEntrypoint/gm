#!/usr/bin/env bash
set -o pipefail
root="${SHIP_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$root" || exit 1
if [ "$#" -lt 2 ]; then
  echo "usage: tools/ship.sh \"<subject>\" <paths...>"
  exit 2
fi
msg="$1"
shift
for path in "$@"; do
  if [ ! -e "$path" ] && ! git ls-files --error-unmatch -- "$path" > /dev/null 2>&1 && ! git cat-file -e "HEAD:$path" 2>/dev/null; then
    echo "refused: $path is neither in the tree nor tracked"
    exit 1
  fi
done
for path in "$@"; do
  if [ -e "$path" ]; then
    git add -A -- "$path" || exit 1
  else
    git rm -q --cached --ignore-unmatch -- "$path" || exit 1
  fi
done
if ! node -e "require.resolve('acorn')" >/dev/null 2>&1; then
  git reset -q -- "$@"
  echo "ship: the gate needs acorn; run npm install in $root and retry" >&2
  exit 1
fi
out="${SHIP_OUT:-/tmp/ship-gate.out}"
node -e "import('./src/gate.mjs').then(async (m) => { const r = await m.runGate(process.cwd()); console.log(JSON.stringify({ gate: r.ok, failed: r.failed })); process.exit(r.ok ? 0 : 1); })" > "$out" 2>&1
rc=$?
tail -n 1 "$out"
echo "gate exit code: $rc"
if [ "$rc" -ne 0 ]; then
  git reset -q -- "$@"
  echo "NOT COMMITTED: the gate failed; the named paths are unstaged"
  exit 1
fi
git commit -q -m "$msg" -- "$@" || exit 1
if [ "${SHIP_PUSH:-1}" = "1" ]; then
  git push -q origin main || exit 1
  echo "COMMITTED $(git rev-parse HEAD) and pushed; gate exit code $rc"
else
  echo "COMMITTED $(git rev-parse HEAD), not pushed; gate exit code $rc"
fi
