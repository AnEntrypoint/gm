---
name: gm-execute
description: EXECUTE phase AND the foundational execution contract for every skill. Every exec:<lang> run, every witnessed check, every code search, in every phase, follows this skill's discipline. Resolve all mutables via witnessed execution. Any new unknown triggers immediate snake back to planning — restart chain from PLAN.
---

# GM EXECUTE — Resolve Every Unknown

GRAPH: `PLAN → [EXECUTE] → EMIT → VERIFY → COMPLETE`
Entry: .prd with named unknowns. From `planning` or re-entered from EMIT/VERIFY.

This skill = execution contract for ALL phases. Other phases reference it because protocols must be fresh. About to run anything → load this skill first.

## TRANSITIONS

**EXIT → EMIT**: all mutables KNOWN → invoke `gm-emit` immediately.
**SELF-LOOP**: still UNKNOWN → re-run different angle (max 2 passes, then regress to PLAN).
**REGRESS → PLAN**: new unknown discovered | mutable unresolvable after 2 passes.

## MUTABLE DISCIPLINE

Each mutable: name | expected | current | resolution method. Zero variance = resolved. Unresolved after 2 passes = snake to `planning`. Never narrate past an unresolved mutable.

Mutables resolve to KNOWN only when ALL four pass:
- **ΔS=0** — witnessed output equals expected
- **λ≥2** — two independent paths agree
- **ε intact** — adjacent invariants hold (types, test.js, neighboring callers)
- **Coverage≥0.70** — enough corpus inspected for retrieval mutables

## PRIORS DON'T AUTHORIZE

Route candidates from PLAN arrive as `weak_prior` only. Plausibility = right to TEST, not right to BELIEVE.
`weak_prior` → witnessed probe → `witnessed` → feed to EMIT.
"The plan says" / "we agreed" / "obviously X" = prior-statements, not witnessed facts.

## CODE EXECUTION

`exec:<lang>` only via Bash tool body: `exec:<lang>\n<code>`

Langs: `exec:nodejs` (default) | `exec:bash` | `exec:python` | `exec:typescript` | `exec:go` | `exec:rust` | `exec:c` | `exec:cpp` | `exec:java` | `exec:deno` | `exec:cmd`

File I/O: exec:nodejs + require('fs'). Git directly in Bash. Never Bash(node/npm/npx/bun).

Pack runs: Promise.allSettled for parallel, each idea own try/catch, under 12s per call.

Runner: `exec:runner\nstart|stop|status`

## CODEBASE SEARCH

`exec:codesearch` only. Grep/Glob/Find/Explore/WebSearch/grep/rg/find inside exec:bash = ALL hook-blocked.

Known absolute path → `Read`. Known dir → exec:nodejs + fs.readdirSync. No third option.

```
exec:codesearch
<two-word query>
```

Iterate: change one word or add one word per pass. Minimum 4 attempts before concluding absent.

## IMPORT-BASED EXECUTION

Always import actual modules. Never rewrite logic inline — reimplemented output = UNKNOWN.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Differential diagnosis: isolate smallest reproduction, compare actual vs expected, name the delta. Delta = the mutable.

## CI — AUTOMATED

git push → Stop hook auto-watches GitHub Actions for pushed HEAD. No manual `gh run watch`.
- All-green → Stop approves with CI summary
- Failure → Stop blocks with run names+IDs → `gh run view <id> --log-failed` for diagnosis
- Deadline 180s (override `GM_CI_WATCH_SECS`)
- Downstream-repo cascades NOT auto-watched — same-repo only

## GROUND TRUTH

Real services, real data, real timing. Mocks/stubs/simulations = delete. Scattered test files (.test.js, .spec.js, __tests__/) = delete. All coverage in root test.js. Fallback/demo modes = remove, fail loud.

**Scan before edit**: exec:codesearch for existing implementation before creating/modifying. Duplicate concern = regress to `planning`.

**Hypothesize via execution**: hypothesis → run → witness → edit. Never edit on unwitnessed assumption.

**Code quality** (stop at first that resolves need): native → library → structure (map/pipeline) → write.

## PARALLEL SUBAGENTS

≤3 `gm:gm` subagents for independent items simultaneously: `Agent(subagent_type="gm:gm", ...)`

Browser escalation: exec:browser → browser skill → navigate/click → screenshot (last resort).

## MEMORIZE — HARD RULE

Unknown→known = memorize same turn it resolves.

Triggers: exec: output answers prior unknown | CI log reveals root cause | code read confirms/refutes | env quirk observed | user states preference/constraint.

```
Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')
```

N facts → N parallel Agent calls in ONE message. End-of-turn self-check mandatory.

**Never**: Bash(node/npm/npx/bun) | fake data | mocks | scattered tests | fallbacks | Grep/Glob/Find/Explore | sequential independent items | respond to user mid-phase | edit before witnessing | duplicate code | if/else where dispatch table suffices | one-liners that obscure | reinvent what native/library provides

**Always**: witness every hypothesis | import real modules | scan before edit | regress on new unknown | delete mocks/comments/scattered tests on discovery | test.js for every behavior change | invoke next skill immediately when done
