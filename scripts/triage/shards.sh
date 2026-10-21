#!/usr/bin/env bash
# Usage: scripts/triage/shards.sh [out-dir]
# Builds drain shard files from the pending row store (<root>/.gm/prd, $GM_ROOT or /workspace/gm). Each row goes
# to the owner its text names (rs-plugkit, gm-mcp, agentplug, ci-scripts, skills-docs, other). Each owner's
# rows are split into files of 20 ids named <owner>-NN, sorted in byte order. The output directory is new
# and dated, so no shard list a running lane reads is ever overwritten. Owners with no rows get no file.
# Output: "<owner>-NN <count>" per shard, then the total. Exit 0.
root=${GM_ROOT:-/workspace/gm}
out=${1:-/tmp/drain-$(date -u +%Y%m%dT%H%M%S)}
[ -e "$out" ] && { echo "exists: $out (choose a new directory)"; exit 1; }
mkdir -p "$out"
pairs="$out/.pairs"
: > "$pairs"
for f in "$root"/.gm/prd/*.yml; do
  [ -f "$f" ] || continue
  id=$(sed -n 's/^id: //p' "$f" | head -1)
  [ -n "$id" ] || continue
  t=$(tr 'A-Z' 'a-z' < "$f")
  case "$t" in
    *rs-plugkit*|*plugkit-core*|*wasm_dispatch*|*dream_rsi*|*orchestrator*) owner=rs-plugkit ;;
    *agentplug*|*daemon*|*runner*) owner=agentplug ;;
    *gm-mcp*|*codemode*|*spool-transport*) owner=gm-mcp ;;
    *ci*|*workflow*|*bump-pins*|*github*) owner=ci-scripts ;;
    *skill*|*docs/*|*readme*) owner=skills-docs ;;
    *) owner=other ;;
  esac
  printf '%s\t%s\n' "$owner" "$id" >> "$pairs"
done
total=0
for owner in rs-plugkit gm-mcp agentplug ci-scripts skills-docs other; do
  awk -F'\t' -v o="$owner" '$1==o {print $2}' "$pairs" | LC_ALL=C sort > "$out/$owner.all"
  [ -s "$out/$owner.all" ] || { rm -f "$out/$owner.all"; continue; }
  (cd "$out" && split -l 20 -d -a 2 "$owner.all" "$owner-")
  for shard in "$out/$owner"-[0-9][0-9]; do
    n=$(wc -l < "$shard")
    total=$((total + n))
    echo "$(basename "$shard") $n"
  done
done
rm -f "$pairs"
echo "total $total into $out"
exit 0
