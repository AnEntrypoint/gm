#!/usr/bin/env bash
# Usage: scripts/triage/writer-lock.sh take <repo> <session>
#        scripts/triage/writer-lock.sh release <repo> <session>
#        scripts/triage/writer-lock.sh status <repo>
#        scripts/triage/writer-lock.sh quarantine-stale <repo>
# One writer per checkout. The lock is <root>/.gm/locks/<repo>.writer ($GM_ROOT or /workspace/gm), created
# atomically with noclobber, so two lanes cannot both take it. quarantine-stale moves the lock to a dated
# quarantine directory (never deletes) only when no git write runs in the repository and no process names the
# holder. Output: the result line. Exit 1 when the lock is held by someone else or cannot be released.
root=${GM_ROOT:-/workspace/gm}
dir="$root/.gm/locks"
mkdir -p "$dir"
cmd=$1
repo=$2
lock="$dir/$repo.writer"
case "$cmd" in
  take)
    session=$3
    if ( set -o noclobber; echo "$session" > "$lock" ) 2>/dev/null; then
      echo "took $repo for $session"
    else
      echo "held by $(cat "$lock" 2>/dev/null)"
      exit 1
    fi
    ;;
  release)
    session=$3
    if [ "$(cat "$lock" 2>/dev/null)" = "$session" ]; then
      rm -f "$lock"
      echo "released $repo"
    else
      echo "not the holder of $repo"
      exit 1
    fi
    ;;
  status)
    cat "$lock" 2>/dev/null || echo "free"
    ;;
  quarantine-stale)
    [ -f "$lock" ] || { echo "free"; exit 0; }
    holder=$(cat "$lock")
    if ps -eo args | grep -E 'git (add|commit|push|pull|merge|rebase|reset|checkout)' | grep -v grep >/dev/null; then
      echo "a git write is live; lock kept"
      exit 1
    fi
    if pgrep -f -- "$holder" >/dev/null 2>&1; then
      echo "holder $holder is live; lock kept"
      exit 1
    fi
    q="$dir/quarantine-stale-$(date -u +%Y%m%dT%H%M%S)"
    mkdir -p "$q" && mv "$lock" "$q/" && echo "quarantined $repo lock held by $holder -> $q"
    ;;
  *)
    echo "usage: writer-lock.sh take|release|status|quarantine-stale ..."
    exit 2
    ;;
esac
