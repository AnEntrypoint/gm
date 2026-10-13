# gm-orchestrate: recovery procedures

Moved out of SKILL.md to keep it under 15 KB. The trigger conditions and the one-line summaries stay in SKILL.md under "Mass API-error drain" and "Editing the skills"; the step detail is here. Reasons: `docs/rationale.md`. Measurements: `docs/incidents.md`.

## Mass API-error drain
A subagent stopping with `API Error: Connection dropped (ECONNRESET)`, `ECONNREFUSED` or `error type: server_error` lost its transport: row stays open, slot free. Both spellings are one class.
0. One drop while the rest of the wave stays live is a single drop: resume that id (rule 1), keep launching. A drain is N of the wave inside one window.
1. `SendMessage` to the dead agent's own id, naming row, project, SESSION_ID. Relaunch a fresh brief only when resume is refused or the id is gone from ListAgents. Never resume an agent whose row already has a live fresh agent.
2. N notifications in one window is one event: log `FAILURE: <UTC> live=<n> pending=<m> event=mass-econnreset-drain-<N>` once; refill to target this turn. Count of record is ListAgents, read once after the window; never decrement live per notification.
3. Refill in two half-waves separated by `wait {"ms":15000}`. Resume-by-id is not exempt from back-pressure. After a drain: `wait {"ms":60000}`, re-count, refill only if the count did not fall again. Recurrence: `1 x 15000`, then `2 x 60000`, then `5 x 60000`, logging interval and count. `wait` accepts `max_ms: 600000`, so a longer window is one call. Never launch into a window still dropping.
4. Never count a dropped agent as live; re-count with ListAgents after each notification and before the next launch block.
5. Third drain in one walk: `prd-add` `<row>-mass-drain-<session>` naming wave size and interval; hold waves at half ceiling until it closes.

## Editing the skills
Skills under `c:/dev/gm/skills/` are live on the next dispatch after any local edit.
- Check `.git/MERGE_HEAD` BEFORE editing; if set, defer the edit or abort a merge nobody owns.
- After `git_pull` in `c:/dev/gm`, re-read every edited skill and re-apply any clobbered hunk.
- Publish path-scoped: `git_finalize {paths:[...]}` naming only edited skill files, then `git_push {rev:"<full sha of tip>", allow_foreign_commits:true}`, then `ci-status` on the pushed sha. Never `rev:"HEAD"`; never publish while another lane holds gm's git.
- Every correction records its motivating measurement: date, verbatim error, counts.
