# Working on gm-new

How to change this project. Project facts are in AGENTS.md, and decisions with their witnesses are in DESIGN.md. This skill is not served to runs; only skills/gm/SKILL.md is.

## Scratch

- Scratch work lives under /tmp/gm-scratch/gm-new. A script never sits in a directory it deletes: a probe that removed its own directory is why this rule exists.
- A witness copies the working tree (tar, without .git, runs and node_modules), runs the real path through the relay, reads the result from the run's log file, and removes its copy.
- A witness for propagation uses a scratch bare repository as origin and a runner checkout started with default settings. It times the push and reads the relay's stderr.

## Witnesses

- Run the real path through the relay, not a unit call. The run's log file is the ground truth; a result a script returns is not.
- Before a filter on the log, read which kinds the log holds for the call. A body's verb call is `code-call`; a top-level tool call writes `action` and `result`. A filter on the wrong kind returns zero and looks like a pass.
- Before a filter reads a row or log field, find every writer of that field and check each one. A field no writer sets makes the filter false for every row, and the reader then reports zero as if it were a fact.
- A witness that edits a file by string counts the matches first and edits the one it means. A sentence that occurs in two places once changed the wrong one.
- Record the before run id and the after run id, with the numbers, in DESIGN.md under a dated section.
- A multi-step change is built as one batch: all the steps, then one witness over all of them, then the commits. A step is not witnessed alone during the build.

## Edits and collisions

- The shared checkout is live: a worker started from it runs its working tree. Build a change in a scratch copy (a tar of the tree), witness it there, and apply it to the checkout in one step once it is witnessed. A half-made edit breaks every worker that restarts.
- Change an existing file with Edit only. Never Write over an existing file.
- On a failed Edit, re-read the region and reapply once. If it fails again, stop and report.
- Only the single writer commits. A collision is repaired after the fact, not avoided.
- On an index.lock error during a commit, retry the add 3 times, 2 seconds apart. Never delete .git/index.lock. If it persists, report it.
- Runtime output is not committed. runs/ is git-ignored, and job files stay there.

## Commit and push

- Commit with `tools/ship.sh "<subject>" <explicit paths>`. It stages those paths, runs the gate, and commits and pushes main only when the gate passes. SHIP_PUSH=0 commits without pushing, for a witness.
- Author lanmower. The subject states the change. No trailers of any kind.
- Work on main. Do not create branches or worktrees.
- A refusal from the gate names each failing check and its detail. Fix the cause and run it again. Do not commit around the gate.

## Reporting

- When a request lands, send the session that asked one message under 15 lines: the item, the run id, the event sequence numbers that witness it, and any open question.
- Keep working on other items while a question is open. Ask one question at a time.
