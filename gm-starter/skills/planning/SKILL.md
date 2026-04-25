---
name: planning
description: State machine orchestrator. Mutable discovery, PRD construction, and full PLAN→EXECUTE→EMIT→VERIFY→COMPLETE lifecycle. Invoke at session start and on any new unknown.
allowed-tools: Write
---

# Planning — State Machine Orchestrator

Runs `PLAN → EXECUTE → EMIT → VERIFY → UPDATE-DOCS → COMPLETE`.

Entry: prompt-submit hook → `gm` → here. Re-enter on any new unknown in any phase.

## UNKNOWNS = PRODUCT

Output = every fault surface work could fail on. Unknown named+resolved = cheaper downstream. Unknown skipped = EMIT/VERIFY surprise = snake back at higher cost.

Later-phase unknown → return here. Not failure — machine working. Patch-around-in-place = compounding debt.

## RECALL — HARD RULE

Before naming any unknown, check past sessions. Cross-session memory is the cheapest mutable resolver.

Triggers (any = run `plugkit recall` BEFORE adding the .prd item):
- Unknown matches a previously-discussed topic in this project
- About to investigate a "have we seen this" question
- About to design an approach where a prior decision likely exists
- Quirk/error feels familiar
- Sub-task in a project worked on before

```
exec:recall
<2-6 word query>
```

Hits are weak_prior — feed the proposed approach into PLAN, but witness via EXECUTE before adopting. Empty hits = proceed normally; no signal lost.

Skip recall only when: brand-new project (no DB) | trivially-bounded edit with zero unknowns | user gave surgical instructions.

## MEMORIZE — HARD RULE

Every unknown resolved → memorize same turn. Not batched, not deferred.

Triggers: exec: output answers prior unknown | code read confirms/refutes | CI log reveals root cause | user states preference/constraint | fix worked non-obviously | env quirk observed.

```
Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')
```

Multiple facts in one turn → parallel Agent calls in ONE message. End-of-turn: scan for missed → spawn now.

**Recall + memorize together = the learning loop.** Recall before investigating; memorize after resolving.

## STATE MACHINE

**FORWARD**: PLAN → `gm-execute` | EXECUTE → `gm-emit` | EMIT → `gm-complete` | VERIFY .prd remains → `gm-execute` | VERIFY .prd empty+pushed → `update-docs`

**REGRESSIONS**: new unknown at any state → re-invoke `planning` | EXECUTE unresolvable 2 passes → `planning` | EMIT logic error → `gm-execute` | EMIT new unknown → `planning` | VERIFY broken output → `gm-emit` | VERIFY logic wrong → `gm-execute` | VERIFY new unknown → `planning`

Runs until: .gm/prd.yml empty AND git clean AND all pushes confirmed AND CI green.

## AUTONOMY — HARD RULE

After PRD is written, EXECUTE through to COMPLETE without asking the user. No mid-task confirmation. No "should I continue". No "want me to do X next". The PRD is the contract; execute it.

Asking is permitted ONLY when absolutely necessary: destructive-irreversible decision with no prior context, OR user intent ambiguous and unrecoverable from PRD/memory/code. Use `exec:pause` (renames prd.yml → prd.paused.yml; question lives in header) as the channel — in-conversation asking is last-resort.

Long task ≠ reason to ask. Cross-repo work ≠ reason to ask. CI wait time ≠ reason to ask. Emit PRD, execute, push.

**Cannot stop while**: .gm/prd.yml has items | git has uncommitted changes | git has unpushed commits.

## SKIP PLANNING (DEFAULT for small work)

Skip if ANY apply:
- Single-file, single-concern edit
- Task trivially bounded, under ~5 min
- User gave explicit surgical instructions
- Bug fix with identified root cause
- Zero unknowns

Heavy ceremony (PRD + parallel subagents) for multi-file architectural work or genuinely unknown fault surfaces. If new unknown surfaces mid-work, THAT is when to regress — not preemptively.

## PLAN PHASE — MUTABLE DISCOVERY

For every aspect of the task:
- What do I not know? → mutable (UNKNOWN)
- What could go wrong? → edge case item with failure mode
- What depends on what? → blocking/blockedBy mapped
- What assumptions am I making? → each = unwitnessed hypothesis = mutable

Fault surfaces: file existence | API shape | data format | dependency versions | runtime behavior | environment differences | error conditions | concurrency hazards | integration seams | backwards compatibility | rollback paths | CI/CD correctness

**Route family** (`governance`): tag every `.prd` item with family — grounding|reasoning|state|execution|observability|boundary|representation. Mis-routed repair = wasted EXECUTE pass.

**Failure-mode mapping**: cross-reference 16-failure taxonomy. No mapping = unexamined surface = silent bug.

**Competing routes stay live** until witnessed execution makes one dominant. Pre-witness collapse = route-into-authorization leak.

**MANDATORY CODEBASE SCAN**: For every item, `existingImpl=UNKNOWN`. Resolve via exec:codesearch. Existing code serving same concern → consolidation, not addition. PDFs indexed page-by-page — search specs same way you search source.

**EXIT PLAN**: zero new unknowns last pass AND all .prd items have acceptance criteria AND dependencies mapped → launch subagents or invoke `gm-execute`.

## OBSERVABILITY — MANDATORY EVERY PASS

Enumerate every runtime observability gap:

**Server**: every subsystem exposes `/debug/<subsystem>`. State readable/filterable without restart. Structured logs with subsystem+severity+timestamp.

**Client**: `window.__debug` is live structured registry. Every component/request/queue/connection addressable by key. Modules register on mount, deregister on unmount.

`console.log` = ad-hoc = not observability. `window.__debug.module.state` = permanent. Discovery of gap → add .prd item immediately. Observability = highest priority, never deferred.

## .PRD FORMAT

Path: `./.gm/prd.yml`. Write via `exec:nodejs` + `fs.writeFileSync`. Delete when empty; delete `.gm/` when completely empty.

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

Status: pending → in_progress → completed (remove completed). Effort: small <15min | medium <45min | large >1h.

## PARALLEL SUBAGENT LAUNCH

After .prd written, launch ≤3 parallel `gm:gm` subagents for all independent items simultaneously. Never sequential.

`Agent(subagent_type="gm:gm", prompt="Work on .prd item: <id>. .prd path: <path>. Item: <full YAML>.")`

After each wave: read .prd, find newly unblocked, launch next. Browser tasks serialize.

When parallelism not applicable: invoke `gm-execute` directly.

## CODE EXECUTION

`exec:<lang>` only via Bash tool. File I/O: exec:nodejs + require('fs'). Git only in Bash directly. Never Bash(node/npm/npx/bun).

Pack runs: `Promise.allSettled` for parallel. Each idea its own try/catch. Under 12s per call.

## CODEBASE EXPLORATION

`exec:codesearch` only. Glob/Grep/Read/Explore = hook-blocked. Start 2 words → change one → add third → minimum 4 attempts before concluding absent.

## MANDATORY DEV WORKFLOW

No comments. No scattered test files. 200-line limit. Fail loud. No duplication. Scan before edit. AGENTS.md via memorize only. CHANGELOG.md: append per commit.

**Minimal code process** (stop at first that resolves need):
1. Native — does language/runtime do this? Use it.
2. Library — existing dep solve this? Use its API.
3. Structure — encode as data (map/table/pipeline)? Make structure enforce correctness.
4. Write — only when 1-3 exhausted.

## SINGLE INTEGRATION TEST POLICY

One `test.js` at project root. 200-line max. No .test.js, .spec.js, __tests__/, fixtures/, mocks/. No frameworks, no mocks, no stubs — plain assertions, real data, real system.

`gm-complete` runs test.js before completion. Failure = regression to EXECUTE. Every behavior change updates test.js. Every bug fix adds regression case.

## RESPONSE POLICY

Terse. Drop filler. Fragments OK. Pattern: `[thing] [action] [reason]. [next step].`
Code/commits/PRs = normal prose.

## CONSTRAINTS

**Never**: Bash(node/npm/npx/bun) | skip planning | partial execution | stop while .prd has items | stop while git dirty | sequential independent items | screenshot before JS exhausted | fallback/demo modes | swallow errors | duplicate concern | leave comments | scattered test files | if/else chains where map suffices | one-liners that require decoding | leave resolved unknown un-memorized | batch memorize | serialize memorize spawns

**Always**: invoke Skill at every transition | regress to planning on new unknown | witnessed execution only | scan before edits | enumerate observability gaps every pass | follow chain end-to-end | prefer dispatch tables | prefer pipelines | make wrong states unrepresentable | spawn memorize same turn unknown resolves | end-of-turn self-check
