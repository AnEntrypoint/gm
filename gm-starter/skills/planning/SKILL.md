---
name: planning
description: State machine orchestrator. Mutable discovery, PRD construction, and full PLAN→EXECUTE→EMIT→VERIFY→COMPLETE lifecycle. Invoke at session start and on any new unknown.
allowed-tools: Write
---

# Planning — State Machine Orchestrator

Runs `PLAN → EXECUTE → EMIT → VERIFY → UPDATE-DOCS → COMPLETE`. Re-enter on any new unknown in any phase.

## RECALL — HARD RULE

Before naming any unknown, run recall.

```
exec:recall
<2-6 word query>
```

Triggers: matches prior topic | "have we seen this" | designing where prior decision likely exists | quirk feels familiar | sub-task in known project.

Hits = weak_prior; witness via EXECUTE before adopting. Skip recall only on brand-new project / trivially-bounded edit / surgical user instruction.

## MEMORIZE — HARD RULE

Every unknown→known = same-turn memorize. Background, parallel, never batched.

```
Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')
```

Triggers: exec output answers prior unknown | code read confirms/refutes | CI log reveals root cause | user states preference/constraint | fix worked non-obviously | env quirk observed.

N facts → N parallel Agent calls in ONE message.

## STATE MACHINE

**FORWARD**: PLAN → `gm-execute` | EXECUTE → `gm-emit` | EMIT → `gm-complete` | VERIFY .prd remains → `gm-execute` | VERIFY .prd empty+pushed → `update-docs`

**REGRESSIONS**: new unknown anywhere → `planning` | EXECUTE unresolvable 2 passes → `planning` | EMIT logic error → `gm-execute` | VERIFY broken output → `gm-emit` | VERIFY logic wrong → `gm-execute`

Runs until: .gm/prd.yml empty AND git clean AND all pushes confirmed AND CI green.

## AUTONOMY — HARD RULE

PRD written → execute to COMPLETE without asking the user. No "should I continue", no "want me to do X next", no offering to split work.

Asking permitted only as last resort: destructive-irreversible with no PRD coverage, OR user intent unrecoverable from PRD/memory/code. Channel: `exec:pause` (renames prd.yml → prd.paused.yml; question in header). In-conversation asking last-resort.

**Cannot stop while**: .gm/prd.yml has items | git uncommitted | git unpushed.

## SKIP PLANNING (DEFAULT for small work)

Skip if ANY: single-file single-concern edit | trivially bounded <5min | surgical user instructions | bug fix with identified root cause | zero unknowns. Heavy ceremony only for multi-file architectural work.

## PLAN PHASE — MUTABLE DISCOVERY

For every aspect: what do I not know (UNKNOWN) | what could go wrong (failure mode) | what depends on what (blocking/blockedBy) | what assumptions am I making (unwitnessed hypothesis = mutable).

Fault surfaces: file existence | API shape | data format | dep versions | runtime behavior | env differences | error conditions | concurrency | integration seams | backwards compat | rollback paths | CI correctness.

**Route family** (governance): tag every item — grounding|reasoning|state|execution|observability|boundary|representation.

**Failure-mode mapping**: cross-reference 16-failure taxonomy.

**MANDATORY CODEBASE SCAN**: `existingImpl=UNKNOWN` for every item. Resolve via exec:codesearch before adding. Existing concern → consolidation, not addition.

**EXIT PLAN**: zero new unknowns last pass AND every item has acceptance criteria AND deps mapped → launch subagents or invoke `gm-execute`.

## OBSERVABILITY — MANDATORY EVERY PASS

Server: every subsystem exposes `/debug/<subsystem>`. Structured logs `{subsystem, severity, ts}`.
Client: `window.__debug` live registry; modules register on mount.

`console.log` ≠ observability. Discovery of gap → add .prd item immediately, never deferred.

## .PRD FORMAT

Path: `./.gm/prd.yml`. Write via `exec:nodejs` + `fs.writeFileSync`. Delete when empty.

```yaml
- id: kebab-id
  subject: Imperative verb phrase
  status: pending
  description: Precise criterion
  effort: small|medium|large
  category: feature|bug|refactor|infra
  route_family: grounding|reasoning|state|execution|observability|boundary|representation
  load: 0.0-1.0
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

**load** axis (consequence — convergence 3.3.0): 0.9 = headline collapses if wrong. 0.7 = sub-argument rebuilt. 0.4 = local patch. 0.1 = nothing breaks. **Verification budget = load × (1 − tier_confidence)**. High-load + low-tier item = top priority. λ>0.75 must be witnessed before EMIT.

Status: pending → in_progress → completed (remove). Effort: small <15min | medium <45min | large >1h.

## PARALLEL SUBAGENT LAUNCH

After .prd written, ≤3 parallel `gm:gm` subagents for independent items in ONE message. Browser tasks serialize.

`Agent(subagent_type="gm:gm", prompt="Work on .prd item: <id>. .prd path: <path>. Item: <full YAML>.")`

Not parallelizable → invoke `gm-execute` directly.

## EXECUTION RULES

`exec:<lang>` only via Bash. File I/O via exec:nodejs + fs. Git directly in Bash. Never Bash(node/npm/npx/bun).

`exec:codesearch` only — Glob/Grep/Find/Explore hook-blocked. Start 2 words → change/add one per pass → minimum 4 attempts before concluding absent.

Pack runs: Promise.allSettled for parallel. Each idea own try/catch. Under 12s per call.

## DEV WORKFLOW

No comments. No scattered test files. 200-line limit per file. Fail loud. No duplication. Scan before edit. AGENTS.md via memorize agent only. CHANGELOG.md append per commit.

**Minimal code process** (stop at first that resolves): native → library → structure (map/pipeline) → write.

## SINGLE INTEGRATION TEST POLICY

One `test.js` at project root. 200-line max. No `.test.js` / `.spec.js` / `__tests__/` / fixtures / mocks. Plain assertions, real data, real system. `gm-complete` runs it. Failure = regression to EXECUTE.

## RESPONSE POLICY

Terse. Drop filler. Fragments OK. Pattern: `[thing] [action] [reason]. [next step].` Code/commits/PRs = normal prose.

## CONSTRAINTS

**Never**: Bash(node/npm/npx/bun) | skip planning | partial execution | stop while .prd has items | stop while git dirty | sequential independent items | screenshot before JS exhausted | fallback/demo modes | swallow errors | duplicate concern | leave comments | scattered tests | if/else where map suffices | one-liners that obscure | leave resolved unknown un-memorized | batch memorize | serialize memorize spawns

**Always**: invoke Skill at every transition | regress to planning on new unknown | witnessed execution only | scan before edits | enumerate observability gaps every pass | follow chain end-to-end | prefer dispatch tables and pipelines | make wrong states unrepresentable | spawn memorize same turn unknown resolves | end-of-turn self-check
