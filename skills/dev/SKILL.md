# Working on gm

How to change this project. Project facts are in AGENTS.md, and decisions with their witnesses are in DESIGN.md. This skill is not served to runs; only skills/gm/SKILL.md and skills/gm-continue/SKILL.md are, as the MCP prompts `gm` (invoked as mcp__gm__gm) and `gm-continue` (invoked as mcp__gm__gm-continue), and as the resources skill://gm/SKILL.md and skill://gm-continue/SKILL.md. The route to each is its resource, read with ReadMcpResourceTool (server gm). Do not call gm or gm-continue with the Skill tool; it is not listed there. The host names mcp__gm__gm and mcp__gm__gm-continue are the expected names under the host's /mcp__<server>__<prompt> rule, not witnessed ones: check them with a /mcp reconnect in a live session, in the host's command list and Skill list.

## Scratch

- Scratch work lives under /tmp/gm-scratch/gm. A script never sits in a directory it deletes: a probe that removed its own directory is why this rule exists.
- A witness copies the working tree as a tar (without .git, runs and node_modules). The copy is not a git clone and not a worktree. The witness runs the real path through the relay, reads the result from the run's log file, and deletes the copy.
- A witness for propagation uses a scratch bare repository as origin and a runner checkout started with default settings. It times the push and reads the relay's stderr.
- A witness driver is started from the shell in the background, never with gm.job_start in the live run: a job is a record in that run's log, so a driver started there put three witness jobs in runs/self.
- Send JSON to a driver with a quoted heredoc (cat >> file <<'EOF'). A body with single quotes broke a printf quoting and sent a garbled line.

## Witnesses

- No unit tests. Do not add a Rust test attribute case, a test file, or a `test(`/`describe(`/`it(` block; the owner's invariant is that unit tests drift out of sync as the code changes and degrade the agentic workflow. Validate dynamically instead: run the real tree, drive the real tool, and quote its output in the witness. `tools/scan-unit-tests.mjs` runs inside `npm run check` as a backstop.
- Run the real path through the relay, not a unit call. The run's log file is the ground truth; a result a script returns is not.
- Before a filter on the log, read which kinds the log holds for the call. A body's verb call is `code-call`; a top-level tool call writes `action` and `result`. A filter on the wrong kind returns zero and looks like a pass.
- Before a filter reads a row or log field, find every writer of that field and check each one. A field no writer sets makes the filter false for every row, and the reader then reports zero as if it were a fact.
- A witness that edits a file by string counts the matches first and edits the one it means. A sentence that occurs in two places once changed the wrong one.
- Record the before run id and the after run id, with the numbers, in DESIGN.md under a dated section.
- Build and check once per Phase B, after the last change. Reuse build/release: when build/release/CMakeCache.txt exists run only `cmake --build build/release`, and do not run `cmake --preset release` again (it reconfigures and costs a full pass). The stamp then names the commit of the last configure, which check-build accepts; only a build that must carry HEAD's stamp is configured again.
- Start a long build or check as a job with `timeoutMs` and wait for it with one `gm.job_status({ job, waitMs, tail })`; do not sleep and poll, and do not end a turn while it runs. Write each witness's wall time in docs/PENDING_VALIDATION.md beside its output.
- A multi-step change is built as one batch: all the steps, then one witness over all of them, then the commits. A step is not witnessed alone during the build.
- The gate's checks call git (syntax, ascii, docs, workers) and load acorn (workers), so a bare tar copy fails it. Copy node_modules into the copy and give the copy its own repository (`git init`, one commit), then run the gate on the copy. That is not a clone of the shared checkout.
- A top-level `return` fails `node --check` in an ES module. A probe that needs one wraps its body in a function.
- A witness that makes a top-level tool call runs with `--surface tools`. The default code surface answers a verb name with -32602, so the call never reaches the verb.
- A host name that does not resolve here goes to a local proxy. gm.fetch needs `NODE_OPTIONS=--use-env-proxy` with HTTP_PROXY, and it tunnels http:// with CONNECT, so the proxy must answer CONNECT; git takes `-c http.proxy=` in the workspace config. A proxy that logs nothing usually means the CONNECT path.
- Stop a witness server by the pid it wrote to a file. A `ps` pattern that names the server also matches the shell that runs the kill.
- A setup or planner that defaults its repository to the process cwd reports another checkout without an error. Compare its HEAD line with `git rev-parse --short HEAD` in the repository you mean before you read its counts.

## Edits and collisions

- The shared checkout is live: a worker started from it runs its working tree. Build a change in a copy of the tree (a tar, see Scratch; not a git clone or a worktree), witness it there, and apply it to the checkout in one step once it passes. A half-made edit breaks every worker that restarts. A change to a reloadable leaf reloads in place. A change to another module the worker loads restarts it, and a change to a module it does not load restarts nothing. A batch that restarts a worker kills its background jobs, so apply it when no worker on the checkout is busy, and tell the peers that run it.
- Change an existing file with Edit only. Never Write over an existing file.
- On a failed Edit, re-read the region and reapply once. If it fails again, stop and report.
- Single writer commits. A collision is repaired after the fact, not avoided.
- AGENTS.md is updated continuously: write each note in the fewest words that keep it instructive. At 30 KB, compress first, then drop notes in this order: what the code already shows, menial steps, then obvious facts. Keep only what took a long run to learn and cannot be read from the code. Tool replies carry only what the next step needs. The gm skill holds the same rule.
- On an index.lock error during a commit, retry the add 3 times, 2 seconds apart. Never delete .git/index.lock. If it persists, report it.
- Runtime output is not committed. runs/ is git-ignored, and job files stay there.
- A commit that removes a row state or a row verb also migrates each row file that still carries the old value. Commit 671cbb0 removed the blocked state and migrated none of the nine blocked rows, so the setup reports each of them on every run.

## Commit and push

- Commit with `tools/ship.sh "<subject>" <explicit paths>`. It stages those paths, runs the gate, and commits and pushes main only when the gate passes. SHIP_PUSH=0 commits without pushing, for a witness.
- Author lanmower. The subject states the change. No trailers of any kind.
- Work on main. Do not create branches or worktrees.
- A refusal from the gate names each failing check and its detail. Fix the cause and run it again. Do not commit around the gate.
- A bare verb name in any skill file fails the gate's skills check (`src/skills.mjs`), because the check reads the text as written. Reword the sentence, or write the name as gm.<verb>.

## Docs

- When a tool, a tool's input, an install step or a skill path changes, update docs/index.html and README.md in the same commit, because they are the public description.

## Reporting

- When a request lands, send the orchestrator one message under 15 lines: the item, the run id, the event sequence numbers that witness it, and any open question.
- Keep working on other items while a question is open. Ask one question at a time.
