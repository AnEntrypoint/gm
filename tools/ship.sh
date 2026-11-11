#!/usr/bin/env bash
set -o pipefail
root="${SHIP_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$root" || exit 1
if [ "$1" = "--push" ]; then
  head="$(git rev-parse HEAD)"
  marker="${SHIP_BUILD:-$root/build/release}/phase-b.pass"
  if [ ! -f "$marker" ] || [ "$(cat "$marker")" != "$head" ]; then
    echo "refused: no passing Phase B at HEAD $head; run tools/phase-b.sh first"
    exit 1
  fi
  git push -q origin main || exit 1
  echo "PUSHED $head"
  exit 0
fi
if [ "$#" -lt 2 ]; then
  echo "usage: tools/ship.sh \"<subject>\" <paths...>  |  tools/ship.sh --push"
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
echo "COMMITTED $(git rev-parse HEAD), local only; gate exit code $rc"
