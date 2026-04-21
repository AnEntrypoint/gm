---
name: planning
description: State machine orchestrator. Mutable discovery, PRD construction, and full PLAN→EXECUTE→EMIT→VERIFY→COMPLETE lifecycle. Invoke at session start and on any new unknown.
allowed-tools: Write
---

# Planning — State Machine Orchestrator

Root of all work. Runs `PLAN → EXECUTE → EMIT → VERIFY → UPDATE-DOCS → COMPLETE`.

**Entry**: prompt-submit hook → `gm` agent → invoke `planning` skill (here). Also re-entered any time a new unknown surfaces in any phase.

## WHERE YOU ARE

Phase where work shape still unknown. Codebase scans, `exec:codesearch` queries, quick imports to probe APIs = all executions. Execution contract in `gm-execute`; protocols not fresh → runs drift (reimplement over import, narrate over witness). Load first.

## UNKNOWNS = PRODUCT

Output of this phase ≠ task list. Output = enumeration of every fault surface work could fail on. Each unknown named + resolved → cheaper downstream. Each unknown skipped → EMIT/VERIFY surprise → snake back anyway at higher cost.

**Unknown emerges later (EXECUTE, EMIT, VERIFY) → return here. Not failure — machine working as designed.** Later-phase unknown means mutable map incomplete. Come back. Think laterally — what else could this touch, what invariant assumed, what subsystem unexamined? Enumerate newly-visible fault surfaces. Only then push forward.

Patch-around-unknowns-in-place = compounding silent-failure debt. Regress early = stay inside contract.

## FRAGILE LEARNINGS — MEMORIZE ON RESOLUTION (HARD RULE)

Every unknown resolved in any phase (existingImpl absent, dep version confirmed, API shape witnessed, env quirk observed, CI failure root-caused, build flag required, user preference stated) = fact that dies on context compaction unless handed off. Not optional. Not batched at end. **Memorize at the moment of resolution, before the next tool call.**

**Trigger contract — memorize fires when ANY of these occur**:
- An `exec:` run produces output that answers a prior "I don't know" / "let me check"
- A code read confirms or refutes an assumption about existing structure
- A CI log reveals the root cause of a failure
- User states a preference, constraint, deadline, or decision
- A fix works and the reason it worked is non-obvious (would be forgotten next session)
- An environment / tooling quirk bites once (blocked tools, path oddities, platform differences)

**Enforcement**:
- Regardless of phase, a resolved unknown → spawn `memorize` subagent **in the same turn** as the resolution. Do not wait for phase end. Do not batch across multiple facts — one call per fact keeps classification clean.
- Run in background (`run_in_background=true`). Non-blocking. Continue work in the same message.
- If you notice at end of turn that an unknown resolved earlier was not memorized, spawn it now. Catching up is allowed. Skipping is not.

**Invocation (copy verbatim, substitute the fact)**:
```
Agent(subagent_type='memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<single resolved fact with enough context for a cold-start agent to use it>')
```

**Parallelization**: multiple unknowns resolved in one turn → spawn multiple memorize agents in the **same message** (parallel tool blocks). Never serialize them.

**Violations = memory leak**. If you leave the turn with a resolved unknown un-memorized, the fact is gone on next compaction. That is the failure mode this rule prevents. Treat every exit from a turn without memorize-catch-up as a bug.

## STATE MACHINE

**FORWARD**: PLAN complete → `gm-execute` | EXECUTE complete → `gm-emit` | EMIT complete → `gm-complete` | VERIFY .prd remains → `gm-execute` | VERIFY .prd empty+pushed → `update-docs`

**REGRESSIONS**: new unknown at any state → re-invoke `planning` | EXECUTE unresolvable 2 passes → `planning` | EMIT logic error → `gm-execute` | EMIT new unknown → `planning` | VERIFY broken output → `gm-emit` | VERIFY logic wrong → `gm-execute` | VERIFY new unknown → `planning`

**Runs until**: .gm/prd.yml empty AND git clean AND all pushes confirmed AND CI green.

## ENFORCEMENT — COMPLETE EVERY TASK END-TO-END

**Cannot respond or stop while**:
- .gm/prd.yml exists and has items
- git has uncommitted changes
- git has unpushed commits

The skill chain MUST be followed completely end-to-end without exception. Partial execution = violation. After every phase: read .prd, check git, invoke next skill.

## PLAN PHASE — MUTABLE DISCOVERY

Planning = exhaustive fault-surface enumeration. For every aspect of the task:
- What do I not know? → mutable (UNKNOWN)
- What could go wrong? → edge case item with failure mode
- What depends on what? → blocking/blockedBy mapped explicitly
- What assumptions am I making? → each = unwitnessed hypothesis = mutable until execution proves it

**Fault surfaces**: file existence | API shape | data format | dependency versions | runtime behavior | environment differences | error conditions | concurrency hazards | integration seams | backwards compatibility | rollback paths | deployment steps | CI/CD correctness

**Route family (Forward Atlas — `twin-atlas` skill)**: every `.prd` item is tagged with at least one of the 7 route families — `grounding | reasoning | state | execution | observability | boundary | representation`. The family disciplines the repair move. Bug in `grounding` does not get a `reasoning` fix; bug in `boundary` does not get a `state` fix. Mis-routed repair = wasted EXECUTE pass + snake back to PLAN. Add `route_family:` to the item YAML.

**Failure-mode mapping**: cross-reference against the 16-failure taxonomy in `twin-atlas`. If the fault you are enumerating does not map to any entry, either you have found a 17th mode (add to twin-atlas) or the fault is not yet named sharply enough — refine until it maps. Items with no failure-mode mapping SHIP silent bugs.

**Competing routes stay live**: if two route families plausibly explain the same symptom, keep both alive in the PRD until witnessed execution makes one dominant. Collapsing to one route pre-witness = route-into-authorization leak (see `twin-atlas` — the first of five refused collapses).

**MANDATORY CODEBASE SCAN**: For every planned item, add `existingImpl=UNKNOWN`. Resolve via exec:codesearch. Existing code serving same concern → consolidation task, not addition. `exec:codesearch` indexes PDFs page-by-page alongside source — spec PDFs, papers, vendor manuals, and RFCs are searchable as code. When planning against a protocol, hardware, or compliance requirement, search the PDF corpus the same way you search source: two words, iterate. A constraint the PRD is missing because it only lives in a PDF is a fault surface — enumerate doc PDFs as scan targets during mutable discovery.

**EXIT PLAN**: zero new unknowns in last pass AND all .prd items have explicit acceptance criteria AND all dependencies mapped → launch subagents or invoke `gm-execute`.

**SELF-LOOP**: new items discovered → add to .prd → plan again.

**Skip planning entirely** (this is the DEFAULT for small work) if ANY of these apply:
- Single-file, single-concern edit
- Task is trivially bounded and under ~5 minutes
- User gave explicit surgical instructions ("change X to Y")
- Bug fix where root cause is already identified
- Zero unknowns / no mutables to resolve

Heavy ceremony (PRD + parallel subagents) is for multi-file architectural work or genuinely unknown fault surfaces. Writing a 7-item PRD for a 3-line change is waste. Err toward skipping — if a new unknown surfaces mid-work, THAT is when you regress to planning, not preemptively.

**Contrast examples:**
- "Fix the hold-detect logic at apcKey25.cpp:163" → SKIP planning. Read, edit, done.
- "Add drift correction and watchdog and observability across the USB audio path" → DO plan. Multi-file, multiple unknowns.

## OBSERVABILITY ENUMERATION — MANDATORY EVERY PASS

During every planning pass, enumerate every possible aspect of the app's runtime observability that can be improved. The goal is permanent structures — not ad-hoc logs — that make any future debugging session start from a complete, live picture of system state.

**Server-side permanent structures**: Every internal subsystem — state machine, queue, cache, connection pool, active task map, process registry, RPC handler, hook dispatcher — must expose a named, queryable inspection endpoint (e.g. `/debug/<subsystem>`). State must be readable, filterable, and ideally modifiable without restart. Profiling hooks on every hot path. Structured logs with subsystem tag, severity, and timestamp — filterable at runtime by subsystem, not just log level. Any internal state that requires a restart to inspect is an observability gap.

**Client-side permanent structures**: `window.__debug` must be a live, structured registry — not a dump. Every component's state, every active request, every event queue, every WebSocket connection, every rendered prop, every error boundary — all addressable by key, all queryable without refreshing. New modules register themselves into `window.__debug` on mount and deregister on unmount. Any execution path not traceable via `window.__debug` is an observability gap.

**Permanent vs ad-hoc**: `console.log` = ad-hoc = not observability. A structured logger with subsystem routing = permanent. `window.__debug.myModule.state` = permanent. `window.__debug = { ...window.__debug, tmp: x }` = ad-hoc = not acceptable. Permanent structures survive deploys and accumulate diagnostic value across sessions.

**Mandate**: on discovery of any observability gap → immediately add a .prd item. Observability improvements are highest-priority — never deferred. The agent must be able to see specifically anything it wants and nothing else — no guessing, no blind spots.

## .PRD FORMAT

Path: `./.gm/prd.yml`. YAML via `exec:nodejs` (use `fs.writeFileSync`). Ensure `.gm/` dir exists before writing. Delete when empty — never leave empty file. Delete `.gm/` dir when completely empty.

```yaml
- id: kebab-id
  subject: Imperative verb phrase
  status: pending
  description: Precise criterion
  effort: small|medium|large
  category: feature|bug|refactor|infra
  route_family: grounding|reasoning|state|execution|observability|boundary|representation
  failure_modes: []
  route_fit: unexamined|examined|dominant
  authorization: none|weak_prior|witnessed
  blocking: []
  blockedBy: []
  acceptance:
    - binary criterion
  edge_cases:
    - failure mode
```

`route_family`, `failure_modes`, `route_fit`, `authorization` come from `twin-atlas`. Required for items with emission impact (architecture, public API, contract change). Small surgical edits may omit. `authorization` starts `none`; gm-execute raises it to `weak_prior` on hypothesis, `witnessed` only when execution has proven it.

Status: `pending` → `in_progress` → `completed` (remove completed items). Effort: small <15min | medium <45min | large >1h.

## PARALLEL SUBAGENT LAUNCH

After .prd written, launch ≤3 parallel `gm:gm` subagents for all independent items simultaneously. Never sequential.

`Agent(subagent_type="gm:gm", prompt="Work on .prd item: <id>. .prd path: <path>. Item: <full YAML>.")`

After each wave: read .prd, find newly unblocked items, launch next wave. Exception: browser tasks serialize.

When parallelism not applicable: invoke `gm-execute` skill directly.

## MUTABLE DISCIPLINE

Each mutable: name | expected | current | resolution method. Resolve by witnessed execution only. Zero variance = resolved. Unresolved after 2 passes = new unknown = re-invoke `planning`. Mutables live in conversation only.

## CODE EXECUTION

`exec:<lang>` only. Bash body: `exec:<lang>\n<code>`

`exec:nodejs` | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`

File I/O: exec:nodejs + require('fs'). Git only in Bash directly. `Bash(node/npm/npx/bun)` = violation.

Pack runs: `Promise.allSettled` for parallel ops. Each idea its own try/catch. Under 12s per call.

Background: `exec:sleep <id>` | `exec:status <id>` | `exec:close <id>`. Runner: `exec:runner start|stop|status`.

## CODEBASE EXPLORATION

`exec:codesearch` only. Glob/Grep/Read/Explore/WebSearch = hook-blocked. Start 2 words → change one word → add third → minimum 4 attempts before concluding absent.

## BROWSER AUTOMATION

Invoke `browser` skill. Escalation: (1) `exec:browser <js>` → (2) browser skill → (3) navigate/click → (4) screenshot last resort. Browser tasks serialize — one Chrome instance per project.

## SKILL REGISTRY

`gm-execute` → `gm-emit` → `gm-complete` → `update-docs` | `browser` | `twin-atlas` (governance reference, read once per session) | `memorize` (sub-agent, background only)

`twin-atlas` carries the Forward/Bridge/Inverse governance model, 7 route families, 16 failure taxonomy, 4 state planes, ΔS/λ/ε/Coverage metrics, and the 8-case governance stress suite. Load once per session at the top of `planning` so protocols stay fresh across phases.

`memorize`: `Agent(subagent_type='memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<what>')`

## MANDATORY DEV WORKFLOW

No comments. No scattered test files. 200-line limit — split before continuing. Fail loud. No duplication. Scan before every edit. Duplicate concern = regress to PLAN. Errors throw with context — no `|| default`, no `catch { return null }`. `window.__debug` exposes all client state. AGENTS.md via memorize only. CHANGELOG.md: append per commit.

**Minimal code / maximal DX process**: Before writing any logic, run this process in order — stop at the first step that resolves the need:
1. **Native first** — does the language or runtime already do this? Use it exactly as designed.
2. **Library second** — does an existing dependency already solve this pattern? Use its API directly.
3. **Structure third** — can the problem be encoded as data (map, table, pipeline) so the structure enforces correctness and eliminates branching entirely?
4. **Write last** — only author new logic when the above three are exhausted. New logic = new surface area = new bugs.

When structure eliminates a whole class of wrong states — name that pattern explicitly. Dispatch tables replacing switch chains, pipelines replacing loop-with-accumulator, maps replacing if/else forests — these are not just style preferences, they are correctness properties. Code that cannot be wrong because of how it is shaped is the goal. Readable top-to-bottom without mental simulation = done right. Requires decoding = not done.

## SINGLE INTEGRATION TEST POLICY

Every project maintains exactly one `test.js` at project root. 200-line max. No other test files anywhere — no `.test.js`, `.spec.js`, `__tests__/`, `fixtures/`, `mocks/`. Delete all scattered tests on discovery and consolidate coverage into `test.js`.

**test.js replaces all unit tests.** It tests the real system end-to-end with real data. No mocks, no stubs, no test frameworks. Plain node assertions or process exit codes.

**Creation**: if `test.js` does not exist, create it during EXECUTE phase covering all testable surface of current work.

**Maintenance**: every code change that adds or modifies behavior must update `test.js` to cover it. Every bug fix must add a regression case that would have caught the bug.

**Structure**: group by subsystem, each subsystem gets a section. When approaching 200 lines, compress older stable tests into tighter assertions to make room for new coverage.

**Execution**: `gm-complete` runs `test.js` before allowing completion. Failure = regression to EXECUTE.

## RESPONSE POLICY

Terse like smart caveman. Technical substance stays. Fluff dies. Default: **full**. Switch: `/caveman lite|full|ultra`.

Drop: articles, filler, pleasantries, hedging. Fragments OK. Short synonyms. Technical terms exact. Code unchanged. Pattern: `[thing] [action] [reason]. [next step].`

Levels: **lite** = no filler, full sentences | **full** = drop articles, fragments OK | **ultra** = abbreviate all, arrows for causality | **wenyan-full** = 文言文, 80-90% compression | **wenyan-ultra** = max classical terse.

Auto-Clarity: drop caveman for security warnings, irreversible confirmations, ambiguous sequences. Resume after. Code/commits/PRs write normal. "stop caveman" / "normal mode": revert.

## CONSTRAINTS

**Tier 0**: no_crash, no_exit, ground_truth_only, real_execution, fail_loud
**Tier 1**: max_file_lines=200, hot_reloadable, checkpoint_state
**Tier 2**: no_duplication, no_hardcoded_values, modularity
**Tier 3**: no_comments, convention_over_code

**Never**: `Bash(node/npm/npx/bun)` | skip planning | partial execution | stop while .gm/prd.yml has items | stop while git dirty | sequential independent items | screenshot before JS exhausted | fallback/demo modes | silently swallow errors | duplicate concern | leave comments | create scattered test files (only root test.js) | write if/else chains where a map or pipeline suffices | write one-liners that require decoding | branch on enumerated cases when a dispatch table exists | **leave a resolved unknown un-memorized** | batch memorize calls until end of turn | serialize parallel memorize spawns

**Always**: invoke named skill at every state transition | regress to planning on any new unknown | witnessed execution only | scan codebase before edits | enumerate every possible observability improvement every planning pass | follow skill chain completely end-to-end on every task without exception | prefer dispatch tables over switch/if chains | prefer pipelines over loop-with-accumulator | make wrong states structurally impossible | name patterns when structure eliminates a whole class of bugs | **spawn `memorize` the same turn an unknown resolves** | parallel-spawn one memorize per fact when multiple resolve together | end-of-turn self-check: any resolved unknowns un-memorized? → spawn now before handing control back
