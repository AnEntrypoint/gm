#!/usr/bin/env bash
# Usage: scripts/triage/publish-on-origin.sh <repo-dir> <row-id> <message> <path>...
# Publishes the listed paths of <repo-dir>'s working tree as one commit on origin/main, without touching the
# working tree, its index or local main. A dirty or diverged checkout does not block it. Steps:
#   1. fetch origin main; build a temporary index from origin/main;
#   2. replace each listed path with its working-tree content (or remove it when the file is gone);
#   3. when a path under skills/ changed, regenerate skills/manifest.sha256 in byte order;
#   4. commit-tree on origin/main with "Row: <row-id>"; run the secrets check on that index;
#   5. push <sha>:refs/heads/main and confirm the sha is an ancestor of origin/main.
# Pass only the paths the lane edited. PUBLISH_BASE=<ref> sets the merge base (default: merge-base with origin). The diff against origin/main is printed before the push.
# Exit 0 only when the sha is on origin/main. Exit 1 on any failure; nothing is pushed then.
set -u
checker="$(cd "$(dirname "$0")/.." && pwd)/check-staged-secrets.mjs"
repo=$1; row=$2; msg=$3; shift 3
[ $# -ge 1 ] || { echo "usage: publish-on-origin.sh <repo-dir> <row-id> <message> <path>..."; exit 2; }
cd "$repo" || exit 1
git fetch -q origin main || { echo "fetch failed"; exit 1; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
# PUBLISH_BASE overrides the base of the three-way merge. Use PUBLISH_BASE=origin/main when the lane's copy
# is a full rewrite of a file whose history it does not share (a merge-base older than the file would make
# an add-add conflict).
base_ref=${PUBLISH_BASE:-$(git merge-base HEAD origin/main)}
export GIT_INDEX_FILE="$T/index"
git read-tree origin/main || { echo "read-tree failed"; exit 1; }
for p in "$@"; do
  # The lane's change is the diff from the merge-base with origin/main to its working tree, so local
  # commits not yet pushed are included. It is applied onto
  # origin/main with a three-way merge, so newer origin content survives. A conflict refuses the publish.
  if [ -f "$p" ]; then
    git show "$base_ref:$p" > "$T/base" 2>/dev/null || : > "$T/base"
    git show "origin/main:$p" > "$T/theirs" 2>/dev/null || : > "$T/theirs"
    cp "$p" "$T/ours"
    if ! git merge-file -p "$T/ours" "$T/base" "$T/theirs" > "$T/merged"; then
      echo "conflict on $p against origin/main; nothing pushed"
      exit 1
    fi
    mode=100644; [ -x "$p" ] && mode=100755
    blob=$(git hash-object -w "$T/merged") || exit 1
    git update-index --add --cacheinfo "$mode,$blob,$p" || exit 1
  else
    git update-index --force-remove "$p" || exit 1
  fi
done
if printf '%s\n' "$@" | grep -q '^skills/'; then
  : > "$T/manifest"
  for f in $(git ls-files skills/ | sed 's#^skills/##' | LC_ALL=C sort); do
    [ "$f" = manifest.sha256 ] && continue
    h=$(git cat-file -p ":skills/$f" | sha256sum | cut -d' ' -f1)
    echo "$h  $f" >> "$T/manifest"
  done
  blob=$(git hash-object -w "$T/manifest") || exit 1
  git update-index --add --cacheinfo "100644,$blob,skills/manifest.sha256" || exit 1
fi
tree=$(git write-tree) || exit 1
sha=$(git commit-tree "$tree" -p origin/main -m "$msg" -m "Row: $row") || exit 1
unset GIT_INDEX_FILE
echo "== commit $sha against origin/main"
git diff --stat origin/main "$sha" -- "$@" | tail -3
if ! GIT_INDEX_FILE="$T/index" node "$checker" >"$T/sec.out" 2>&1; then
  tail -1 "$T/sec.out"
  echo "secrets check failed; nothing pushed"
  exit 1
fi
if [ "${PUBLISH_DRY_RUN:-0}" = 1 ]; then
  echo "dry run: built $sha on origin/main, secrets check passed, not pushed"
  exit 0
fi
git push -q origin "$sha:refs/heads/main" || { echo "push refused; nothing landed"; exit 1; }
git fetch -q origin main
if git merge-base --is-ancestor "$sha" origin/main; then
  echo "published $sha on origin/main"
  exit 0
fi
echo "push reported success but $sha is not on origin/main"
exit 1
