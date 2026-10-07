#!/usr/bin/env bash
# Verify every submodule pin recorded in HEAD exists on that submodule's remote. An unpublished pin makes
# every fresh `git clone --recurse-submodules` fail. Usage: check-pins.sh   (run from the gm root)
bad=0
git ls-tree HEAD | awk '$2=="commit"{print $3, $4}' | while read -r sha path; do
  url=$(git config -f .gitmodules --get "submodule.$path.url") || continue
  if git ls-remote "$url" 2>/dev/null | cut -f1 | grep -q "^$sha"; then echo "ok       $path ${sha:0:8}"
  elif git -C "$path" fetch -q origin "$sha" 2>/dev/null; then echo "ok       $path ${sha:0:8} (reachable by sha)"
  else echo "MISSING  $path ${sha:0:8} -- not on $url"; echo bad >/tmp/.pins-bad.$$; fi
done
[ -f /tmp/.pins-bad.$$ ] && { rm -f /tmp/.pins-bad.$$; exit 1; }; exit 0
