# Pool worker: standing rules

Rules for the whole run of every pool worker. The spawn carries only parameters: row, session, role and, for traversal, `node` (one source file under a traversal root; `surface` is its legacy alias, same value).

## 1. Heartbeat first

Write `.gm/pool/<session>.live` in the project root, exactly three lines:

    session: <session>
    row: <row id>
    start: <ISO-8601 UTC>

Before writing, read every `.gm/pool/*.live`; if a fresh one (under 10 minutes old) names your row, stop and return `row held by <session>`.

Refresh the heartbeat at least every 5 minutes, at any gm call, not only while waiting on a lock or a long run.

## 2. Check the row

Read the last block for your row id in the gm store; it decides the state. If the row is absent or resolved, delete your heartbeat and return.

## 3. Role

- Row resolver: run the nine stages on the row's own criteria.
- Traversal hop: log node-only PRDs, resolve none.
  - Each confirmed node-only row is prd-added at once. Never batch rows to the end of the hop.
  - A hop with zero rows logged 15 minutes after its heartbeat start stops and returns a receipt: surfaces scanned, candidates checked, rows logged (0), and the reason.

## 4. Execution limits

- Node only, unless the row names a GPU or browser arm and the lock or lease is free.
- Never use a background wait, a scheduled wake-up, a cron job, shell sleep or shell grep.
- Wait only with gm verbs: the `wait` verb, body `{"ms": N}`, N a positive integer in milliseconds, maximum 60000 per call. Example: `dispatch wait --body '{"ms":3000}'`.

## 5. Git

Each worker commits and pushes its own scoped change in the same run; do not wait for the orchestrator to ask.

- Commit with `git_commit` and explicit `paths` naming only the files this run changed, then push with `git_push {"rev":"HEAD"}`. `git_finalize` with the same `paths` does both in one call. Never commit without `paths`.
- Leave other lanes' modified or untracked files uncommitted. Read `git_status` first; commit only the paths you changed.
- Commit as lanmower, the configured git identity, with no Co-Authored-By, session-id or generated-by line. The body states the change and why and carries one `Row: <id>` trailer.
- Stay on main. A worker creates no branch or worktree and never amends a pushed commit.
- Read the pushed commit back with `git_show {"rev":"<sha>"}`, check its CI with `ci-status {"sha":"<sha>","github_repo":"<owner/name>"}`, and report sha and CI state in your return. A pending or unknown CI state is reported as such, never as passing.
- Raw git in the host shell stays forbidden; every git operation goes through a gm git verb.

## 6. Blockers

Record each blocker as a new row, id `<row>-blocker-<session>`. Never reuse the row's own id; that rescopes the row.

## 7. Closing

1. Nominate a successor from the `slots.candidates` list in the orchestrator's instruction response; a free-text nomination is advisory only.
2. Delete your heartbeat.
3. Return: the stage reached; the receipt or blocker (the RESULT line or the failing output); files changed; the successor.