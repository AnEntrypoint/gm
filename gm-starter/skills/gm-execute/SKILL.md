---
name: gm-execute
description: EXECUTE phase AND the foundational execution contract for every skill. Every exec:<lang> run, every witnessed check, every code search, in every phase, follows this skill's discipline. Resolve all mutables via witnessed execution. Any new unknown triggers immediate snake back to planning — restart chain from PLAN.
---

# GM EXECUTE — Resolving Every Unknown

You are in the **EXECUTE** phase. Every mutable on `.gm/prd.yml` carries UNKNOWN status until witnessed execution resolves it. Job here = the witnessing.

This skill also carries the **execution contract** applying in every phase, not only this one. Planning runs codebase scans; EMIT runs pre-emit diagnostics; VERIFY runs integration tests and CI watches — all executions, all subject to discipline below. Other skills reference this skill because protocols stay live in context only while this text is nearby. About to run anything → this skill freshly loaded OR operating outside contract.

New unknown surfaced by a run → stop, state-regress to `planning`, restart chain.

**GRAPH POSITION**: `PLAN → [EXECUTE] → EMIT → VERIFY → COMPLETE`
- **Entry**: .prd exists with all unknowns named. Entered from `planning` or via snake from EMIT/VERIFY.

## TRANSITIONS

**EXIT — invoke `gm-emit` skill immediately when**: All mutables are KNOWN (zero UNKNOWN remaining). Do not wait, do not summarize. Invoke the skill.

**SELF-LOOP (remain in EXECUTE state)**: Mutable still UNKNOWN after one pass → re-run with different angle (max 2 passes, then regress to PLAN)

**STATE REGRESSIONS**:
- New unknown discovered → invoke `planning` skill immediately, reset to PLAN state
- EXECUTE mutable unresolvable after 2 passes → invoke `planning` skill, reset to PLAN state
- Re-entered from EMIT state (logic error) → re-resolve the mutable, then re-invoke `gm-emit` skill
- Re-entered from VERIFY state (runtime failure) → re-resolve with real system state, then re-invoke `gm-emit` skill

## MUTABLE DISCIPLINE

Each mutable: name | expected | current | resolution method. Execute → witness → assign → compare. Zero variance = resolved. Unresolved after 2 passes = new unknown = snake to `planning`. Never narrate past an unresolved mutable.

## WEAK-PRIOR BRIDGE — PRIORS DO NOT AUTHORIZE

EXECUTE receives route candidates from PLAN. Per the weak-prior rule in `governance`: **those candidates arrive as weak priors only — structural value preserved, authorization NOT transferred**. Route plausibility ≠ authorization. A plausible route earns the right to be TESTED, not the right to be BELIEVED.

- Prior from PLAN: `authorization=weak_prior`. Permitted use: pick the next witnessed probe.
- After witnessed probe succeeds: `authorization=witnessed`. Permitted use: feed into EMIT.
- Collapsing `weak_prior` to `witnessed` without a witnessed probe = route-into-authorization leak (collapse #1 in `governance`). Snake to PLAN.

Rhetorical inflation also strips here: "the plan says" / "we agreed that" / "obviously X" are prior-statements, not witnessed-facts. Restate as weak prior, run the probe, witness, only then authorize.

## QUALITY METRICS — APPLY BEFORE MARKING KNOWN

Every mutable passes all four before status flips UNKNOWN → KNOWN (see `governance` for full definitions):

- **ΔS = 0** — witnessed output equals expected
- **λ ≥ 2** — two independent paths agree (different search, different caller, different import), not just one confirmation
- **ε intact** — adjacent invariants still hold (neighboring callers, types, test.js, nearby modules unbroken)
- **Coverage ≥ 0.70** — for retrieval/search mutables, enough of the corpus was inspected to rule out contradicting evidence

Single-witness resolution (`λ=1`) = still unknown. One passing run on happy path without probing error paths = `ε` unverified. Skipping these checks and marking KNOWN anyway is an authorization-without-witness violation.

## CODE EXECUTION

**exec:<lang> is the only way to run code.** Bash tool body: `exec:<lang>\n<code>`

`exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`

Lang auto-detected if omitted. `cwd` sets directory. File I/O via exec:nodejs + require('fs'). Only git in bash directly. `Bash(node/npm/npx/bun)` = violations.

**Execution efficiency — pack every run:**
- Combine multiple independent operations into one exec call using `Promise.allSettled` or parallel subprocess spawning
- Each independent idea gets its own try/catch with independent error reporting — never let one failure block another
- Target under 12s per exec call; split work across multiple calls only when dependencies require it
- Prefer a single well-structured exec that does 5 things over 5 sequential execs

**Background tasks** (auto-backgrounded when execution exceeds 15s):
```
exec:sleep
<task_id> [seconds]
```
```
exec:status
<task_id>
```
```
exec:close
<task_id>
```

**Runner**:
```
exec:runner
start|stop|status
```

## GIT PUSH = CI WATCH — MANDATORY EVERY TIME

A `git push` that is not immediately followed by a CI watch is an unwitnessed execution and a violation of this contract. The push triggers GitHub Actions workflows; those workflows are remote execution whose results are ground truth. Every push — intermediate commits during EXECUTE, doc pushes during UPDATE-DOCS, every push — triggers this same protocol:

1. Immediately after `git push` succeeds, list the runs the push triggered:
```
exec:bash
gh run list --limit 5 --json databaseId,name,status,conclusion,headBranch,event,createdAt
```

2. For every run with `status` = `queued` or `in_progress` (from this push), watch until terminal:
```
exec:bash
gh run watch <run_id> --exit-status
```

3. On failure, inspect logs and decide:
```
exec:bash
gh run view <run_id> --log-failed
```
- Caused by your change → regress to the appropriate phase (emit for file issues, execute for logic, planning for new unknowns), fix, re-push, re-watch.
- Pre-existing (not introduced by this session) → document as a known issue in CLAUDE.md with the failing workflow name and reason, then continue. A pre-existing failure is still a KNOWN mutable, just resolved differently.

4. Cascade: a push may trigger downstream repo workflows (see AGENTS.md pipeline notes). After local CI reaches terminal state, check downstream:
```
exec:bash
gh run list --repo AnEntrypoint/<downstream> --limit 3 --json databaseId,name,status,conclusion
```
Watch and triage the same way.

**Zero silent pushes.** Not watching a CI run you triggered = operating outside this contract. This rule supersedes any implicit assumption that CI can be "checked later in gm-complete" — if you are about to push, you are about to execute code remotely, so the watch happens now.

## CODEBASE EXPLORATION — exec:codesearch ONLY

**Grep, Glob, Find, Explore, WebSearch, and `grep`/`rg`/`find` inside `exec:bash` are ALL hook-blocked.** Attempting them returns a redirect error. The hook is not a suggestion — it is enforced. `Read` is available for known absolute paths.

Default reflex for "I need to find X in the codebase" = `exec:codesearch`. No exceptions. Not even for exact strings, not even for regex, not even for "just one quick check". If you find yourself reaching for Grep or Glob, that reflex is wrong — replace with codesearch.

```
exec:codesearch
<two-word query to start>
```

`exec:codesearch` handles exact strings, symbols, regex-ish patterns, file-name fragments, and PDF pages (indexed page-by-page with `file:page` citations). Two words in, iterate by changing or adding one word per pass, minimum four attempts before concluding absent. Full protocol in `code-search` skill.

**Direct-read exceptions** (no search needed):
- Known absolute path → `Read` tool.
- Directory listing at known path → `exec:nodejs` + `fs.readdirSync`.
- File content inspection without search → `Read`.

**Never**:
- `Grep`, `Glob`, `Find`, `Explore` tools (all hook-blocked)
- `grep`, `rg`, `ripgrep`, `find`, `ag`, `ack` inside `exec:bash` (banned-tool hook intercepts)
- Reaching for exact-match tools "because codesearch seems fuzzy" — codesearch handles exact matches fine

When a mutable depends on external specification (protocol field, register layout, compliance text), search the PDF corpus first. Unwitnessed assumption from a doc you did not search = UNKNOWN.

**Platform note — exec:bash on Windows:** runs real bash (git-bash) when installed, falls back to PowerShell otherwise. If you see a POSIX-syntax parse error (`[ -n ...]`, `&&`, `if/then/fi`), bash wasn't found — either install git-bash or rewrite in `exec:nodejs`.

## DIAGNOSTIC PROTOCOL — IMPORT-BASED EXECUTION

Always import actual codebase modules. Never rewrite logic inline. Reimplemented output is unwitnessed and inadmissible as ground truth.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Witnessed import output = resolved mutable. Reimplemented output = UNKNOWN.

**Differential diagnosis**: when behavior diverges from expectation, run the smallest possible isolation test first. Compare actual vs expected. Name the delta. The delta is the mutable — resolve it before touching any file.

## EXECUTION DENSITY

Pack every related hypothesis into one run. Each run ≤15s. Witnessed output = ground truth. Narrated assumption = inadmissible.

Parallel waves: ≤3 `gm:gm` subagents via Agent tool (`Agent(subagent_type="gm:gm", ...)`) — independent items simultaneously, never sequentially.

## CHAIN DECOMPOSITION — FAULT ISOLATION

Break every multi-step operation before running end-to-end. Treat each step as a diagnostic unit:
1. Number every distinct step
2. Per step: input shape, output shape, success condition, failure mode
3. Run each step in isolation — witness output — assign mutable — must be KNOWN before proceeding to next step
4. Debug adjacent step pairs for handoff correctness — the seam between steps is the most common failure site
5. Only when all pairs pass: run full chain end-to-end

Step failure revealing new unknown → regress to `planning` state immediately.

## BROWSER DIAGNOSTIC ESCALATION

Invoke `browser` skill. Exhaust each level before advancing to next:
1. `exec:browser\n<js>` — inspect DOM state, read globals, check network responses. Always first.
2. `browser` skill — for full session workflows requiring navigation
3. navigate/click/type — only when real events required and DOM inspection insufficient
4. screenshot — last resort, only after all JS-based diagnostics exhausted

## GROUND TRUTH ENFORCEMENT

Real services, real data, real timing. Mocks/fakes/stubs/simulations = diagnostic noise = delete immediately. No scattered test files (.test.js, .spec.js, __tests__/) — delete on discovery. All test coverage belongs in the single root `test.js`. If `test.js` does not exist, create it. Every behavior change updates `test.js`. Every bug fix adds a regression case. No fallback/demo modes — errors must surface with full diagnostic context and fail loud.

**SCAN BEFORE EDIT**: Before modifying or creating any file, search the codebase (exec:codesearch) for existing implementations of the same concern. "Duplicate" means overlapping responsibility, similar logic, or parallel implementations — not just identical files. If consolidation is possible, regress to `planning` with restructuring instructions instead of continuing.

**HYPOTHESIZE VIA EXECUTION — NEVER VIA ASSUMPTION**: Formulate a falsifiable hypothesis. Run it. Witness the output. The output either confirms or falsifies. Only a witnessed falsification justifies editing a file. Never edit based on unwitnessed assumptions — form hypothesis → run → witness → edit.

**CODE QUALITY PROCESS**: The goal is minimal code / maximal DX. When writing or reviewing any block of code, run this mental process: (1) What native language/platform feature already does this? Use it. (2) What library already solves this pattern? Use it. (3) Can this branch/loop be a data structure — a map, array, or pipeline — where the structure itself enforces correctness? Make it so. (4) Would a newcomer read this top-to-bottom and immediately understand what it does without running it? If no, restructure. One-liners that compress logic are the opposite of DX — clarity comes from structure, not brevity. Dispatch tables, pipeline chains, and native APIs eliminate entire categories of bugs by making wrong states unrepresentable.

## FRAGILE LEARNINGS — HARD RULE

Every UNKNOWN→KNOWN transition during execution = fact that dies on compaction. The memorize spawn is **not** end-of-phase cleanup — it fires **the same turn the fact resolves**, before the next tool call if possible, end-of-turn at latest.

**Trigger contract** (any = fire):
- `exec:` output resolves a prior "let me check" / "does this API take X" / "what version is installed"
- CI log or error output reveals a root cause
- Code read confirms or refutes an assumption about existing structure
- Environment / tooling quirk observed (blocked commands, platform-specific behavior, path resolution)
- User states a preference, constraint, deadline, or judgment call

**Invocation** (one per fact, background, parallel when multiple):
```
Agent(subagent_type='memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact with enough context for a cold-start agent>')
```

**Parallel spawn**: N facts resolved in one turn → N memorize calls in a **single message**, parallel tool blocks. Never serialize. Never merge multiple facts into one prompt.

**End-of-turn self-check** (mandatory): before the response closes, scan the turn for resolved unknowns that were not memorized. Missed one → spawn now. No exceptions — a resolved unknown leaving the turn without handoff is a memory leak.

Skip memorize = forget on purpose. Treat it as a bug.

## DO NOT STOP

Never respond to the user from this phase. When all mutables are KNOWN, immediately invoke `gm-emit` skill. The chain continues until .prd is deleted and git is clean — that happens in `gm-complete`, not here.

## CONSTRAINTS

**Never**: `Bash(node/npm/npx/bun)` | fake data | mock files | scattered test files (only root test.js) | fallback/demo modes | `Grep`/`Glob`/`Find`/`Explore` tools or `grep`/`rg`/`find` inside `exec:bash` (ALL hook-blocked — use `exec:codesearch` for every codebase lookup, `Read` for known absolute paths) | sequential independent items | absorb surprises silently | respond to user or pause for input | edit files before executing to understand current behavior | duplicate existing code | write explicit if/else chains when a dispatch table or native method suffices | write packed one-liners that obscure structure | reinvent what a library or native API already provides

**Always**: witness every hypothesis | import real modules | scan codebase before creating/editing files | regress to planning on any new unknown | fix immediately on discovery | delete mocks/stubs/comments/scattered test files on discovery | consolidate test coverage into root test.js | add regression case to test.js for every bug fix | invoke next skill immediately when done | ask "what native feature solves this?" before writing any new logic | prefer structures where wrong states are unrepresentable

---

**EXIT → EMIT**: All mutables KNOWN → invoke `gm-emit` skill immediately.
**SELF-LOOP**: Still UNKNOWN → re-run (max 2 passes, then regress to PLAN).
**REGRESS → PLAN**: Any new unknown → invoke `planning` skill, reset to PLAN state.
