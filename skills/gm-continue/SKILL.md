---
name: gm-continue
description: Final check of a gm run. Lists the remaining work from the open PRD rows, open questions and the task, fills the rows that are missing, writes what the run learned to AGENTS.md and the process skill, and sends the run back to gm when work remains, or lets it finish when none does. Load it before every finish of a gm run.
---

# gm-continue

Load this before you send `finish` in a gm run, and after a context compaction that lands while a run is open. It does no work itself. It lists what remains, fills the rows that are missing, and then either sends the run back to gm or lets it finish.

INVARIANT, when finishing: load skill gm, in this same run, when any work remains. Pass it the remaining rows as its arguments. Do not send `finish` while work remains.

## What remains

1. The task is the one in your last `next_context` reply. Keep its literal words.
2. Read the open work in one `run_code` body, with the rows in one `Promise.all`:

```
const [prd, questions] = await Promise.all([gm.prd_list({ status: 'open' }), gm.unknown_list({ status: 'open' })]);
return { prd: prd.output, questions: questions.output };
```

3. Each open row is remaining work. An open question is remaining work too: resolve it with the evidence, or name it as work.

## Fill the missing rows

4. For each piece of the task's literal words that no open row covers, add a row. Check the list by title first, so a row is not added twice:

```
const want = ['the exact piece of the request, in the request's words'];
const open = (await gm.prd_list({ status: 'open' })).output;
const added = [];
for (const title of want) if (!open.includes(title)) added.push((await gm.prd_add({ title, body: 'from the request' })).output);
return { added };
```

5. Exercise the live system against the request's words. Run the real path the user would use and read its output. Any mismatch is remaining work, added as a row.

## Write what the run learned

6. Troubleshooting discoveries from this run go to the project's notes, before the run is sent back or finished:
   - A project fact (how the code behaves, a limit, a surprise): one line under "Facts found by troubleshooting" in AGENTS.md, with the DESIGN.md section that records it.
   - A process lesson (how to witness, commit, recover a collision, use scratch space): a line in the project's process skill, in the section it belongs to. For gm-new that is skills/dev/SKILL.md. The served gm skill is for runs, so process prose does not go there.
7. Keep AGENTS.md lean. Delete any line that needed no troubleshooting to learn, any line about finished work, and any line the code, a tool description or DESIGN.md already states. Keep the file under 30 KB. If it grows past that, rebuild it from the decided list, the facts and the rationale, not from the history.
8. Change the files with Edit only, reading each region first. Commit them by explicit path with the project's commit path (for gm-new, tools/ship.sh, in skills/dev/SKILL.md).

## Send the run back, or let it finish

9. If any row is open, or one was just added: load skill gm, with the remaining rows as its arguments. Say what remains in one line per row, then say that finishing now would leave it undone. Keep working in this run until `gm.prd_list` with `status: 'open'` returns no rows. Do not send `finish` in this step.
10. If no row is open, and step 5 passed: confirm with a real check in one `run_code` body, the check the task names, and read its output. Send `finish` after the body returns, with that output as the witness.
11. Stop only when the open count is zero and step 10 passed in this step. Never end the turn with prose alone while a row is open.
