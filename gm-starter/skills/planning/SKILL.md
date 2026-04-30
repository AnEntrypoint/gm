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

PRD written → execute to COMPLETE without asking the user. Doubts that arise during execution are resolved by witnessed probe, by recall, or by re-reading the PRD — never by asking. Any question whose answer is reachable from the agent's tools belongs to the agent, not the user.

Asking is last-resort: destructive-irreversible without PRD coverage, OR user intent irrecoverable from PRD/memory/code/web. Channel: `exec:pause` (renames `prd.yml` → `prd.paused.yml`; question in header). In-conversation asking is last-resort beneath last-resort.

**WEB-SEARCH BEFORE PAUSE — HARD RULE.** Before `exec:pause` for any blocking question whose answer could plausibly exist on the public web — missing artifact, unknown library/API, prebuilt binary, version compatibility, build recipe, upstream status — fire `WebSearch` and at least one `WebFetch` first. Only after the web pass returns empty (or returns options the agent then witnesses and rejects) is `exec:pause` legitimate. Pausing on a question the web could have answered is forced closure dressed up as humility — fix on sight by re-entering planning, web-searching, and resuming. The only questions that genuinely require user-ask are ones the public web cannot answer: private credentials, intent/preference between viable options the agent has *already surfaced*, destructive-irreversible authorization.

**Cannot stop while**: `.gm/prd.yml` has items | git uncommitted | git unpushed.

## MAXIMAL COVER — HARD RULE

When scope exceeds reach, expand the cover. Don't refuse. Don't ship one slice with the rest abandoned as "follow-up" — that's distributed refusal: the same failure dressed up as triage.

**Required move when scope exceeds reach**: construct a *covering family* — every bounded subset of the request that is witnessable from this session — and write the family into the PRD as separate items, with the dependency graph explicit so independent members parallelize. Execute every member.

**Residuals the agent judges within the spirit of the original ask AND completable from this session are self-authorized — expand the PRD with them and execute, do not stop to ask.** The judgment is the agent's honest read of what the user probably wanted, paired with reachability from this session. Only residuals genuinely outside the original ask, or genuinely unreachable from this session, are name-and-stop. When expanding under self-authorization, the agent declares its judgment in the response ("treating X as in-scope because Y") so the user can correct mid-chain. Silent expansion without the declaration is the failure mode this rule guards against.

Enforcement is on what is delivered, not on which words appear. Before closing the turn, check that committed work + named out-of-spirit residuals = witnessable closure of the request. Gap = cover not yet maximal → re-enter PLAN to expand.

## FIX ON SIGHT — HARD RULE

Every issue surfaced during planning, execution, or verification is fixed in-band, the same session, at root cause. A known-bad signal carried past the moment of detection — by deferral, suppression, silencing, skipping, or "next time" narration — is a small forced closure.

Surface → diagnose → fix → re-witness → continue. New unknown surfaced by the fix → regress here. Genuinely out-of-scope-irreversible → the residual goes into `.gm/prd.yml` *before* moving on; narration is not a substitute for an item.

## BROWSER WITNESS — HARD RULE

A `.prd` item that touches browser-facing code is not plan-complete unless its acceptance criteria include a live `exec:browser` witness with a `page.evaluate` assertion against the specific invariant the change establishes. "Manual verification", "test.js passes", and "browser test optional" are all unwitnessed and therefore unacceptable.

The trigger is functional, not a path-list: any change whose effect is observable in the DOM, canvas, WebGL surface, network frames captured by the page, or any global the page exposes, requires the browser witness. Pure-prose edits to static documents with no behavior change are exempt; the exemption is tagged on the item with the reason.

Propagation: EXECUTE witnesses on edit, EMIT re-witnesses post-write, VERIFY runs the final gate. The plan must encode the rule so all three layers fire.

## ORIENT — HARD RULE

Open every plan with a parallel pack of `exec:recall` and `exec:codesearch` against the request's nouns. Hits land as `weak_prior`; misses confirm the unknown is fresh. The pack runs in one message — never serially. The agent that skips orient pays the same cost in fresh probes a turn later, plus the price of disagreeing with its own prior witness.

## PRD — HARD RULE

`./.gm/prd.yml` is the authorization. It is written before EXECUTE fires for any task that touches more than one line in one file. The cost of writing it equals the cost of skipping it; what the file buys is durable trace, resumability, and the cover-maximality check.

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

**No parallel observability surfaces.** `window.__debug` is THE in-page registry; `test.js` at project root is the sole out-of-page test asset. Any new file whose purpose is to exercise, smoke-test, demo, or sandbox in-page behavior outside that registry fights the discipline — extend the registry instead.

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

File paths in `exec:nodejs` are platform-literal — node's `fs` does not auto-resolve POSIX shortcuts like `/tmp`. Use `os.tmpdir()` and `path.join` for portable temp paths; reserve `/tmp/...` for `exec:bash` heredocs where the shell rewrites the prefix.

Every `exec:<lang>` and `exec:bash` call should pass `--timeout-ms <ms>` (mandatory at the rs-exec RPC layer; the CLI emits a transitional warning when omitted). On timeout, partial streamed output is preserved and the runner emits `[exec timed out after Nms; partial output above]` — treat the marker as authoritative truncation and re-issue with a higher budget rather than retrying blindly.

**Utility-verb syntax**: `exec:wait`, `exec:sleep`, `exec:status`, `exec:close`, `exec:pause`, `exec:type`, `exec:runner`, `exec:kill-port`, `exec:recall`, `exec:memorize`, `exec:forget` all take their argument on the **next line** (heredoc body), never inline. `exec:status\n<task_id>` polls one task; bare `exec:status` lists all. `exec:sleep\n<task_id>` blocks until the task produces output or completes. `exec:close\n<task_id>` terminates and removes a task. Inline forms (`exec:status <id>`) are denied by the hook.

`exec:codesearch` only — Glob/Grep/Find/Explore hook-blocked. Start 2 words → change/add one per pass → minimum 4 attempts before concluding absent.

Pack runs: Promise.allSettled for parallel. Each idea own try/catch. Under 12s per call.

## DEV WORKFLOW

No comments. No scattered test files. 200-line limit per file. Fail loud. No duplication. Scan before edit. AGENTS.md via memorize agent only. CHANGELOG.md append per commit.

**Minimal code process** (stop at first that resolves): native → library → structure (map/pipeline) → write.

## SINGLE INTEGRATION TEST POLICY

One `test.js` at project root. 200-line max. No fixtures, mocks, or scattered test files under any naming convention. Plain assertions, real data, real system. `gm-complete` runs it. Failure = regression to EXECUTE.

Any second test runner — under any name, in any directory — is a smuggled parallel surface and fights the discipline. If a behavior needs to be exercised in-page, register it in `window.__debug` and assert via `test.js`.

## RESPONSE POLICY

Terse. Drop filler. Fragments OK. Pattern: `[thing] [action] [reason]. [next step].` Code/commits/PRs = normal prose.

## CONSTRAINTS

**Never**: Bash(node/npm/npx/bun) | skip planning | partial execution | stop while .prd has items | stop while git dirty | sequential independent items | screenshot before JS exhausted | fallback/demo modes | swallow errors | duplicate concern | leave comments | scattered tests | if/else where map suffices | one-liners that obscure | leave resolved unknown un-memorized | batch memorize | serialize memorize spawns

**Always**: invoke Skill at every transition | regress to planning on new unknown | witnessed execution only | scan before edits | enumerate observability gaps every pass | follow chain end-to-end | prefer dispatch tables and pipelines | make wrong states unrepresentable | spawn memorize same turn unknown resolves | end-of-turn self-check
