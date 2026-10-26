# gm-orchestrate: recovery procedures

Moved out of SKILL.md to keep it short. The trigger conditions and the one-line summaries stay in SKILL.md under "Mass API-error drain" and "Editing the skills"; the step detail is here. Reasons: `skills/gm-orchestrate/docs/rationale.md`. Measurements: `docs/verified-incidents.md`.

## Mass API-error drain
A subagent stopping with `API Error: Connection dropped (ECONNRESET)`, `ECONNREFUSED` or `error type: server_error` lost its transport: row stays open, slot free. Both spellings are one class.
0. One drop while the rest of the wave stays live is a single drop: restart that row (rule 1), keep launching. A drain is N of the wave inside one window.
1. Restart, never resume: a fresh subagent for the same row, session `<session>-r<n>` (cap and log per SKILL.md, "Connectivity restarts"), briefed with row, project and SESSION_ID. Never send a message to the dead agent's session id, if the host supports messaging. Never restart a row that already has a live fresh agent. Release the dead agent's claim first: delete its `.gm/pool/<session>.live` (or let it go stale), so the row shows no live holder. The restart writes its own heartbeat. File no new row for the drop: the open row is the only record, and a second row for it is a duplicate.
2. N notifications in one window is one event: log `FAILURE: <UTC> live=<n> pending=<m> event=mass-econnreset-drain-<N>` once; refill to target this turn. Count of record is the live subagent count, read once after the window; never decrement live per notification.
3. Refill in two half-waves separated by `wait {"ms":15000}`. A restart is not exempt from back-pressure. After a drain: `wait {"ms":60000}`, re-count, refill only if the count did not fall again. Recurrence: `1 x 15000`, then `2 x 60000`, then `5 x 60000`, logging interval and count. `wait` accepts `max_ms: 600000`, so a longer window is one call. Never launch into a window still dropping.
4. Never count a dropped agent as live; re-count live subagents after each notification and before the next launch block.
5. Third drain in one walk: `prd-add` `<row>-mass-drain-<session>` naming wave size and interval; hold waves at half ceiling until it closes.

## Editing the skills
Skills under `c:/dev/gm/skills/` are live on the next dispatch after any local edit.
- Check `.git/MERGE_HEAD` BEFORE editing; if set, reconcile that merge per the gm collision rules (gm, Autonomy) in the same turn, then edit. Never abort another lane's merge.
- After `git_pull` in `c:/dev/gm`, re-read every edited skill and re-apply any clobbered hunk.
- Publish path-scoped: `git_finalize {paths:[...]}` naming only edited skill files, then `git_push {rev:"<full sha of tip>", allow_foreign_commits:true}`, then `ci-status` on the pushed sha. Never `rev:"HEAD"`; never publish while another lane holds gm's git.
- Every correction records its motivating measurement: date, verbatim error, counts.
