#!/usr/bin/env bash
# Verify every submodule pin recorded in HEAD exists on that submodule's remote. An unpublished pin makes
# every fresh `git clone --recurse-submodules` fail. Usage: check-pins.sh   (run from the gm root)
# Fetches one commit by sha from the remote into a throwaway repo, so a pin that is
# reachable from a branch but is not its tip resolves without a submodule checkout (CI runs with submodules: false).
fetched_by_sha() {
  local tmp rc=1
  tmp=$(mktemp -d) || return 1
  if git init -q --bare "$tmp" && git -C "$tmp" fetch -q "$1" "$2" 2>/dev/null; then rc=0; fi
  rm -rf "$tmp"
  return $rc
}

bad=0
while read -r _ type sha path; do
  [ "$type" = commit ] || continue
  url=$(git config -f .gitmodules --get "submodule.$path.url") || continue
  if git ls-remote "$url" 2>/dev/null | cut -f1 | grep -q "^$sha"; then echo "ok       $path ${sha:0:8}"
  elif fetched_by_sha "$url" "$sha"; then echo "ok       $path ${sha:0:8} (reachable by sha)"
  else echo "MISSING  $path ${sha:0:8} -- not on $url"; bad=1; fi
done < <(git ls-tree HEAD)
exit $bad
