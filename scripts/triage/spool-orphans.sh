#!/usr/bin/env bash
# Usage: scripts/triage/spool-orphans.sh [--dry-run] <repo-root>...
# Moves each .inflight request under <repo-root>/.gm/exec-spool/in whose owning dispatch has no live process
# into a dated quarantine directory beside it. Never deletes. A live request is reported and left in place.
# Output: one line per request: "live", "orphan" (dry run) or "moved". Exit 0.
dry=0
if [ "$1" = "--dry-run" ]; then dry=1; shift; fi
for root in "$@"; do
  spool="$root/.gm/exec-spool/in"
  [ -d "$spool" ] || continue
  q="$root/.gm/exec-spool/in-quarantine-orphan-$(date -u +%Y%m%dT%H%M%S)"
  while IFS= read -r -d '' f; do
    id=$(basename "$f" .txt.inflight)
    if pgrep -f -- "$id" >/dev/null 2>&1; then echo "live     $f"; continue; fi
    if [ "$dry" = 1 ]; then echo "orphan   $f"; continue; fi
    rel=${f#"$spool/"}
    mkdir -p "$q/$(dirname "$rel")" && mv "$f" "$q/$rel" && echo "moved    $f -> $q/$rel"
  done < <(find "$spool" -name '*.inflight' -type f -print0)
done
exit 0
