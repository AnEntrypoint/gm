---
name: gm-execute
description: EXECUTE phase AND the foundational execution contract for every skill. Every exec:<lang> run, every witnessed check, every code search, in every phase, follows this skill's discipline. Resolve all mutables via witnessed execution. Any new unknown triggers immediate snake back to planning — restart chain from PLAN.
---

# GM EXECUTE — Resolve Every Unknown

GRAPH: `PLAN → [EXECUTE] → EMIT → VERIFY → COMPLETE`. Entry: .prd with named unknowns.

This skill = execution contract for ALL phases. About to run anything → load this first.

## TRANSITIONS

- **EXIT → EMIT**: all mutables KNOWN → invoke `gm-emit`.
- **SELF-LOOP**: still UNKNOWN → re-run different angle (max 2 passes).
- **REGRESS → PLAN**: new unknown | unresolvable after 2 passes.

## MUTABLE DISCIPLINE

Each mutable: name | expected | current | resolution method.

Resolves to KNOWN only when ALL four pass:
- **ΔS=0** — witnessed output equals expected
- **λ≥2** — two independent paths agree
- **ε intact** — adjacent invariants hold
- **Coverage≥0.70** — enough corpus inspected

Unresolved after 2 passes = regress to `planning`. Never narrate past an unresolved mutable.

## PRIORS DON'T AUTHORIZE

Route candidates from PLAN = `weak_prior` only. Plausibility = right to TEST, not BELIEVE.
weak_prior → witnessed probe → witnessed → feed to EMIT. "The plan says" / "obviously X" = prior, not fact.

Claims in response prose stand or fall by their last witness. A claim with no witness in this session is a hypothesis, not a finding — say so when you state it, and say what would settle it. The next reader (you, next turn) needs to know which lines were earned and which were carried forward.

## VERIFICATION BUDGET

Spend on `.prd` items in descending order of consequence-if-wrong × distance-from-witnessed. Items whose failure would collapse the headline finding must reach witnessed status before EMIT; items with sub-argument-level consequence need at minimum a stated fallback path.

## CODE EXECUTION

`exec:<lang>` only via Bash: `exec:<lang>\n<code>`

Langs: `nodejs` (default) | `bash` | `python` | `typescript` | `go` | `rust` | `c` | `cpp` | `java` | `deno` | `cmd`

File I/O: exec:nodejs + require('fs'). Git directly in Bash. **Never** Bash(node/npm/npx/bun).

Pack runs: Promise.allSettled parallel, each idea own try/catch, under 12s per call.
Runner: `exec:runner\nstart|stop|status`

## CODEBASE SEARCH

`exec:codesearch` only. Grep/Glob/Find/Explore/grep/rg/find = hook-blocked.

Known absolute path → `Read`. Known dir → exec:nodejs + fs.readdirSync.

```
exec:codesearch
<two-word query>
```

Iterate: change/add one word per pass. Min 4 attempts before concluding absent.

## IMPORT-BASED EXECUTION

Always import actual modules. Reimplemented = UNKNOWN.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Differential diagnosis: smallest reproduction → compare actual vs expected → name the delta = mutable.

## CI — AUTOMATED

`git push` → Stop hook auto-watches Actions for pushed HEAD. Same-repo only — downstream cascades not auto-watched.
- Green → Stop approves with summary
- Failure → run names+IDs → `gh run view <id> --log-failed`
- Deadline 180s (override `GM_CI_WATCH_SECS`)

## GROUND TRUTH

Real services, real data, real timing. Mocks/stubs/scattered tests/fallbacks = delete.

**Scan before edit**: exec:codesearch before creating/modifying. Duplicate concern = regress to `planning`.
**Hypothesize via execution**: hypothesis → run → witness → edit. Never edit on unwitnessed assumption.
**Code quality**: native → library → structure (map/pipeline) → write.

## PARALLEL SUBAGENTS

≤3 `gm:gm` subagents for independent items in ONE message. Browser escalation: exec:browser → browser skill → screenshot last resort.

## RECALL — HARD RULE

Before resolving any new unknown via fresh execution, recall first.

```
exec:recall
<2-6 word query>
```

Triggers: "did we hit this" | feels familiar | new sub-task in known project | about to comment a non-obvious choice | about to ask user something likely discussed.

Hits = weak_prior; still witness. Empty = proceed. Capped 6s, ~5ms when serve running. ~200 tokens / 5 hits.

## MEMORIZE — HARD RULE

Unknown→known = same-turn memorize.

```
Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')
```

Triggers: exec output answers prior unknown | CI log reveals root cause | code read confirms/refutes | env quirk | user states preference/constraint.

N facts → N parallel Agent calls in ONE message. End-of-turn self-check mandatory.

## FIX ON SIGHT — HARD RULE

Issue surfaced mid-execution (failing test, exec stderr, broken import, runtime exception, lint/type error, deprecation warning, unexpected output) is fixed THIS turn, at root cause, in-band. Never `// TODO`, never `try/catch`-to-swallow, never `2>/dev/null`, never `.skip`, never "out of scope" inside the same file. Re-witness after fix. New unknown surfaced by the fix → regress to `planning`. Genuine out-of-scope → write a `.gm/prd.yml` item before continuing.

**Incidental errors auto-plan**: a reasonably-fixable issue that is *not* what the user asked about — pre-existing build break, lockfile drift, broken dep feature, dead import in adjacent module, missing artifact, neighboring lint failure — still belongs to the agent. Add it to `.gm/prd.yml` the same turn it surfaces and execute it before COMPLETE. Do not ask the user; do not narrate past it; do not file it as "next session." Only errors that genuinely need user credentials, decisions, or external services that are down are name-and-stop, recorded with `blockedBy: external`.

**Obvious re-architecting auto-plans**: same discipline for clear refactor wins surfaced mid-task — code competing with an existing library/package that does the same thing, multi-file ad-hoc logic one import would replace, duplicated logic asking for one helper. Regress to `planning`, add the item, execute. Bar is *obvious + reachable from this session*; speculative refactors stay out.

**Cross-session PRD**: items in `.gm/prd.yml` from prior sessions are this session's work the moment they're discovered. Finish every item in the file before COMPLETE — including ones the current user message did not mention. "From another session" is not an exemption.

## BROWSER WITNESS — HARD RULE

Editing browser-facing code (under `client/`, `docs/`, `*.html`, shaders, page-bundle imports, served JS/CSS, gh-pages assets, anything imported by a browser entry, anything visible in DOM/canvas/WebGL) → live `exec:browser` witness in THIS phase, same turn as the edit. Not deferred to EMIT, not deferred to VERIFY — those layers re-witness on top, they don't replace this one.

Protocol on every client edit:
1. Boot server / open page → HTTP 200 witnessed
2. `exec:browser` → `page.goto(url)` → poll the affected global (`window.__app.<system>`, `window.__debug.<module>`)
3. `page.evaluate` asserting the specific invariant the change establishes — capture numbers
4. Variance → fix at root cause, re-witness (FIX ON SIGHT). Never advance to EMIT on unwitnessed client behavior.

Forbidden: `node test.js` green as a substitute | screenshot without evaluate | "I'll check it in VERIFY" then skipping | committing a client diff without an `exec:browser` block this turn. Exempt only for server-only / no-browser repos; tag the exemption explicitly.

## CONSTRAINTS

**Never**: Bash(node/npm/npx/bun) | fake data | mocks | scattered tests | fallbacks | Grep/Glob/Find/Explore | sequential independent items | respond mid-phase | edit before witnessing | duplicate code | if/else where dispatch suffices | one-liners that obscure | reinvent native/library

**Always**: witness every hypothesis | import real modules | scan before edit | regress on new unknown | delete mocks/comments/scattered tests on discovery | update test.js for behavior changes | invoke next skill immediately when done | weight verification by load
