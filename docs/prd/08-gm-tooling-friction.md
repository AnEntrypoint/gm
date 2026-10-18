# 08 Fix gm tooling friction seen during this port

## Observed issues

- The gm MCP server served `/workspace/oscraft` when called without an explicit cwd. Every call in this port passed `cwd` to work around it.
- A spool dispatch sat unclaimed for more than two minutes while the claim sweep reported a stall. The daemon was alive and had free claim slots.
- A `task-output` poll was refused with `long-gap-no-instruction` after a long idle gap, so a recovery `instruction` dispatch was needed.
- A `git_push` with `rev:"HEAD"` was refused as symbolic, and the push then needed a full sha.
- A `git_commit` subject over 50 characters was refused. Commit message rules are enforced by the verb.

## Scope

- Make the default project root follow the session cwd, or refuse calls that would run in another project.
- Diagnose the claim-sweep stall in the daemon, and record the cause in `docs/verified-incidents.md`.

## Acceptance

- A call with no cwd from `/workspace/gm` resolves to `/workspace/gm`.
- The spool claim sweep completes within its 30 s bound under the same load.

## Witness

A live dispatch from a default-cwd call that reports `/workspace/gm` as its project.
