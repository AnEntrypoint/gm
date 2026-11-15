# fx move inventory

This file is a synthesis of three fx work inventories. It is not a primary source. Each count and row below comes from one of the files listed under Sources, and the files are the authority if they disagree with this summary.

## Sources

- /workspace/fx/work/host-gm-gap-inventory.json: read-only remote resolution and host/gm gap scan. Commit 79ee1ce2a5240978d793c3e845311e114a36ecd2, tree 5a407442d9d818c3ba5734e0809e54b1939a0c91, status finished.
- /workspace/fx/work/inventory-host-tools.json: host tools and gm verbs, generated 2026-11-07.
- /workspace/fx/work/inventory-runtime-surfaces.json: schema 1, 272 surface rows, 29 exact paths, 19 open reasons.

Not included: a merged inventory from an earlier round. None could be found in the gm or fx trees or in the conversation record, so nothing here is taken from it.

## Counts

| Source | Measure | Value |
| --- | --- | --- |
| host-tools | host tools | 32 |
| host-tools | gm verbs | 44 |
| host-tools | total | 76 |
| runtime-surfaces | surface rows | 272 |
| runtime-surfaces | PRESENT | 240 |
| runtime-surfaces | OPEN | 32 |
| host-gm-gap | files scanned | 1532 |
| host-gm-gap | tokens present in fx | 48 |
| host-gm-gap | tokens missing in fx | 6 |
| host-gm-gap | tokens excluded | 5 |

The runtime-surfaces file reports gmVerbCount 0 and an empty gmVerbs list. The 44 gm verbs therefore come only from inventory-host-tools.json.

## Host tools (32)

Agent, AskUserQuestion, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, ListAgents, ListMcpResourcesTool, Monitor, NotebookEdit, PushNotification, Read, ReadMcpResourceDirTool, ReadMcpResourceTool, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskStop, WebFetch, WebSearch, Workflow, Write, mcp__gm__finish, mcp__gm__next_context, mcp__gm__run_code.

## gm verbs (44)

read_file, write_file, edit_file, stat_file, list_dir, run_shell, job_start, job_status, job_stop, query_log, search, wiki_search, grep, wiki_write, review_packet, review_record, review_join, fetch, callers, impact, git_status, git_add, git_rm, git_commit, git_push, git_log, git_diff, git_show, git_fetch, git_pull, git_checkout, git_branch, ci_status, prd_add, prd_list, prd_resolve, unknown_add, unknown_list, unknown_resolve, prd_delete, prd_park, prd_reopen, playwriter_execute, playwriter_browsers.

## Host and gm gap

Token scan of fx files (1532 scanned): 48 tokens present, 6 missing, 5 excluded.

Missing in fx, recorded as new gaps: ListAgents, ReportFindings, SendMessage, mcp__gm__finish, mcp__gm__next_context, mcp__gm__run_code.

A present token means the name occurs somewhere in fx. It does not show that the tool is implemented. For example, Agent appears 189 times, mostly in .fx/skills/fx-cli-shape.

## Open surface rows (32)

By category: host_tools 14, scheduling_cron 7, push_remote_state 6, background_host 5.

Reasons, grouped:

- Needs a network service or external authentication: WebFetch, WebSearch, DesignSync, gh. No network write or credential change is authorized.
- Needs the project browser, which is host-only: playwriter_execute, playwriter_browsers.
- Host session scheduler or event stream, which fx cannot own: CronCreate, CronDelete, CronList, ScheduleWakeup, Monitor, TaskStop.
- Needs host multi-agent orchestration or a model service: Agent, Workflow.
- Host push service unavailable locally: PushNotification.
- Excluded by INVARIANT 7 (no worktrees): EnterWorktree, ExitWorktree.
- Push to a remote: git_push, held until the owner authorizes a resolving AnEntrypoint remote.
- Standing holds: push HELD, no repo creation, no credential change, no force push, no network writes.
- One open question row, unknown-mw6bc4mv1c00, has no resolution in the source.

## Remote state

The gap file's exact non-force push command is `git -C /workspace/fx/fx push AnEntrypoint main`. It was not run.

Remote checks, each a read-only probe:

- AnEntrypoint/gmfx over HTTPS: repository not found (exit 128).
- AnEntrypoint/gmfx over SSH: permission denied, publickey (exit 128).
- AnEntrypoint/fx over HTTPS: repository not found (exit 128).

No fx remote resolves, so the fx push cannot proceed. The owner must decide the repository, its URL and credentials.

## Blocked (from the gap file)

- Push of fx to a resolving remote.
- Binary build.
- All 8 binary-runtime acceptance checks.

## Evidence limits

- A host-tool row is PRESENT when a node check finds its name in the fx transcript file. That confirms the name occurs in the transcript, not that the tool works.
- The token scan is a text match over fx files, so a hit is not proof of an implementation.
- The gm verb list exists only in inventory-host-tools.json; the runtime-surfaces file has none.
