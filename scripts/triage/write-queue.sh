#!/usr/bin/env bash
# Usage: scripts/triage/write-queue.sh add <repo> <row-id> "<what the edit is>"
#        scripts/triage/write-queue.sh list <repo>
#        scripts/triage/write-queue.sh done <repo> <row-id>
# A lane that verifies a row needing an edit in a checkout it cannot write (the writer lock is held, or the
# checkout is dirty) queues the edit here instead of dropping it. The next writer lane for that repository
# lists the queue after it takes the lock and works its rows first. One line per row: <row-id><TAB><note>.
# $GM_ROOT overrides /workspace/gm. Output: the queue or the action taken.
root=${GM_ROOT:-/workspace/gm}
dir="$root/.gm/queues"
mkdir -p "$dir"
cmd=$1
repo=$2
q="$dir/$repo.rows"
case "$cmd" in
  add)
    row=$3
    note=$(printf '%s' "$4" | tr '\t\n' '  ')
    if [ -f "$q" ] && grep -q "^$row	" "$q"; then echo "already queued: $row"; exit 0; fi
    printf '%s\t%s\n' "$row" "$note" >> "$q"
    echo "queued $row for $repo"
    ;;
  list)
    [ -f "$q" ] && cat "$q" || echo "queue empty for $repo"
    ;;
  done)
    row=$3
    [ -f "$q" ] || { echo "queue empty for $repo"; exit 0; }
    grep -v "^$row	" "$q" > "$q.tmp" || true
    mv "$q.tmp" "$q"
    echo "done $row for $repo"
    ;;
  *)
    echo "usage: write-queue.sh add|list|done ..."
    exit 2
    ;;
esac
