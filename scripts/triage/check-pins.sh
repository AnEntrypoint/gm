#!/usr/bin/env bash
# Verify every submodule pin recorded in HEAD exists on that submodule's remote. An unpublished pin makes
# every fresh `git clone --recurse-submodules` fail. Usage: check-pins.sh   (run from the gm root)
bad=0
while read -r _ type sha path; do
  [ "$type" = commit ] || continue
  url=$(git config -f .gitmodules --get "submodule.$path.url") || continue
  if git ls-remote "$url" 2>/dev/null | cut -f1 | grep -q "^$sha"; then echo "ok       $path ${sha:0:8}"
  elif git -C "$path" fetch -q origin "$sha" 2>/dev/null; then echo "ok       $path ${sha:0:8} (reachable by sha)"
  else echo "MISSING  $path ${sha:0:8} -- not on $url"; bad=1; fi
done < <(git ls-tree HEAD)
exit $bad
