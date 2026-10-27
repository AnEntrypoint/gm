# 08 Fix gm tooling friction seen during this port

## Observed issues

- gm MCP server serve `/workspace/oscraft` if no explicit cwd. Every call this port pass `cwd` to work around.
- Spool dispatch sit unclaimed >2 min while claim sweep report stall. Daemon alive, free claim slots.
- `task-output` poll refused with `long-gap-no-instruction` after long idle gap; recovery `instruction` dispatch needed.
- `git_push` with `rev:"HEAD"` refused as symbolic; push then need full sha.
- `git_commit` subject over 50 chars refused. Commit message rules enforced by verb.

## Scope

- Make default project root follow session cwd, or refuse calls running in other project.
- Diagnose claim-sweep stall in daemon. Record cause in `docs/verified-incidents.md`.

## Acceptance

- Call no cwd from `/workspace/gm` resolve to `/workspace/gm`.
- Spool claim sweep finish within 30 s bound under same load.

## Witness

Live dispatch from default-cwd call report `/workspace/gm` as project.