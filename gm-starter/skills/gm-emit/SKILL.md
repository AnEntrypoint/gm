---
name: gm-emit
description: EMIT phase. Pre-emit debug, write files, post-emit verify from disk. Any new unknown triggers immediate snake back to planning — restart chain.
---

# GM EMIT — Write and Verify

GRAPH: `PLAN → EXECUTE → [EMIT] → VERIFY → COMPLETE`
Entry: all mutables KNOWN. From `gm-execute` or re-entered from VERIFY.

## TRANSITIONS

**EXIT → VERIFY**: all gate conditions true → invoke `gm-complete` immediately.
**SELF-LOOP**: post-emit variance with known cause → fix, re-verify, stay in EMIT.
**REGRESS → EXECUTE**: pre-emit reveals known logic error.
**REGRESS → PLAN**: pre-emit reveals new unknown | post-emit variance with unknown cause | scope changed.

## LEGITIMACY GATE (before pre-emit run)

For every claim landing in a file:
1. **Earned specificity** — traces to `authorization=witnessed`, not inflated from weak prior?
2. **Repair legality** — local patch dressed as structural repair? Downgrade scope or snake to PLAN.
3. **Lawful downgrade** — can a weaker, true statement replace it? PREFER the downgrade.
4. **Alternative-route suppression** — live competing route being silenced? Preserve it.

Fail any → regress to `gm-execute` to witness what was missing, or `planning` if gap is structural.

## PRE-EMIT RUN (mandatory before writing any file)

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

1. Import actual module from disk — witness current behavior as baseline
2. Run proposed logic in isolation WITHOUT writing — witness with real inputs
3. Probe failure paths with real error inputs
4. Compare: matches expected → write. Unexpected → new unknown → `planning`.

## WRITING FILES

`exec:nodejs` with `require('fs')`. Write only when every gate mutable resolved simultaneously.

## POST-EMIT VERIFICATION (immediately after writing)

1. Re-import from disk (not in-memory — stale is inadmissible)
2. Run identical inputs as pre-emit — must match pre-emit baseline exactly
3. Known variance → fix immediately, re-verify (EMIT self-loop)
4. Unknown variance → new unknown → invoke `planning`

## GATE CONDITIONS (all true simultaneously)

- Legitimacy gate passed; none of five refused collapses
- Pre-emit passed with real inputs + error inputs
- Post-emit matches pre-emit exactly
- Hot reloadable; errors throw with context (no fallbacks, `|| default`, `catch { return null }`)
- No mocks/fakes/stubs/scattered test files (delete on discovery)
- Files ≤200 lines
- No duplicate concern (run exec:codesearch for primary concern after writing; any overlap → `planning`)
- No comments; no hardcoded values; no adjectives in identifiers; no unnecessary files
- Observability: new server subsystems expose `/debug/<subsystem>`; new client modules in `window.__debug`
- Structure: no if/else where dispatch table suffices; no one-liners that require decoding; no reinvented APIs
- All facts resolved this phase memorized via background Agent(memorize)
- CHANGELOG.md updated; TODO.md cleared/deleted

## CODE EXECUTION

`exec:<lang>` only. File writes via exec:nodejs + require('fs'). Never Bash(node/npm/npx/bun).
Pack runs: Promise.allSettled, each idea own try/catch, under 12s per call.

## CODEBASE SEARCH

`exec:codesearch` only. Grep/Glob/Find/Explore = hook-blocked. Known path → `Read`.

## MEMORIZE

```
Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')
```

Same turn as resolution. Parallel when multiple. End-of-turn self-check mandatory.

**Never**: write before pre-emit | advance with post-emit variance | absorb surprises | respond to user mid-phase
