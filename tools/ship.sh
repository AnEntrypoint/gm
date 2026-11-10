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
branch="$(git symbolic-ref --short -q HEAD)"
[ "$branch" = "main" ] || { echo "refused: ship commits on main, not on '${branch:-a detached HEAD}'"; exit 1; }
for ident in GIT_AUTHOR_IDENT GIT_COMMITTER_IDENT; do
  name="$(git var "$ident" 2>/dev/null | sed 's/ <.*//')"
  [ "$name" = "lanmower" ] || { echo "refused: $ident name must be lanmower"; exit 1; }
done
trailers="$(printf '%s\n' "$msg" | tail -n +2 | while IFS= read -r line; do [ -n "$line" ] && printf 'subject\n\n%s\n' "$line" | git interpret-trailers --parse; done)"
if [ -n "$trailers" ] || printf '%s\n' "$msg" | grep -qiE 'co-authored-by|signed-off-by|generated with'; then
  echo "refused: the commit message carries a trailer"
  exit 1
fi
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
  sha="$(git rev-parse HEAD)"
  candidate="gm-ci-${sha:0:12}"
  cleanup() { git push -q origin ":refs/tags/$candidate" >/dev/null 2>&1; }
  git push -q origin "$sha:refs/tags/$candidate" || { echo "NOT PUSHED: the candidate ref $candidate could not be created; the commit stays local"; exit 1; }
  if ! gh workflow run release.yml --ref "$candidate" -f publish=false >/dev/null || ! gh workflow run arm-diagnose.yml --ref "$candidate" >/dev/null; then
    cleanup
    echo "NOT PUSHED: the CI dispatch on $candidate failed; the commit stays local"
    exit 1
  fi
  node "$root/tools/ci-candidate.mjs" "$sha" "$candidate" "${SHIP_CI_TIMEOUT_MIN:-120}"
  ci=$?
  cleanup
  if [ "$ci" -ne 0 ]; then
    echo "NOT PUSHED: CI for $sha is not green (ci-candidate exit $ci); the commit stays local"
    exit 1
  fi
  git push -q origin main || { echo "NOT PUSHED: origin/main moved; fetch, rebase and ship again"; exit 1; }
  echo "COMMITTED $sha, CI green on $candidate, and pushed; gate exit code $rc"
else
  echo "COMMITTED $(git rev-parse HEAD), not pushed; gate exit code $rc"
fi
