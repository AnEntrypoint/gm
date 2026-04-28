---
name: gm-complete
description: VERIFY and COMPLETE phase. End-to-end system verification and git enforcement. Any new unknown triggers immediate snake back to planning — restart chain.
---

# GM COMPLETE — Verify and Complete

GRAPH: `PLAN → EXECUTE → EMIT → [VERIFY] → UPDATE-DOCS → COMPLETE`
Entry: all EMIT gates passed. From `gm-emit`.

## TRANSITIONS

**EXIT → EXECUTE**: .prd items remain → invoke `gm-execute` immediately.
**EXIT → COMPLETE**: .prd deleted + test.js passes + pushed + CI green → invoke `update-docs`.
**REGRESS → EMIT**: broken file output.
**REGRESS → EXECUTE**: logic wrong.
**REGRESS → PLAN**: new unknown or wrong requirements.

Failure triage: broken output → EMIT | wrong logic → EXECUTE | new unknown → PLAN. Never patch around surprises.

## MUTABLES — ALL MUST RESOLVE BEFORE COMPLETE

- `witnessed_e2e` — real end-to-end run with witnessed output
- `browser_validated` — MANDATORY for any change touching client/UI/browser-facing code (anything served to a browser, rendered, or whose output is visible to a user). Must invoke `browser` skill, navigate the live page, and witness the change in `window` / DOM / scene state. test.js + node-side imports DO NOT satisfy this gate. See BROWSER VALIDATION GATE below.
- `git_clean` — `git status --porcelain` returns empty
- `git_pushed` — `git log origin/main..HEAD --oneline` returns empty
- `ci_passed` — all GitHub Actions runs reach `conclusion: success`
- `prd_empty` — `.gm/prd.yml` deleted (file must not exist)
- `stress_suite_clear` — change walked through all applicable governance stress cases (M1-D1), none flunk
- `hidden_decision_posture` — advances open→down_weighted→closed only when CI green + stress suite clear

## END-TO-END VERIFICATION

Run real system, real data, witness actual output. NOT verification: docs updates, saying done, screenshots alone.

```
exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Browser/UI: invoke `browser` skill. After every success: enumerate what remains — never stop at first green.

## BROWSER VALIDATION GATE — MANDATORY FOR CLIENT WORK

If this session changed any code that runs in a browser — anything under client/, UI components, shaders, page-loaded JS, served HTML, gh-pages assets, dev-server endpoints, or any module imported into the page bundle — `browser_validated` MUST resolve before COMPLETE. Skipping it because "node tests pass" or "test.js is green" is a forced-closure refusal of witnessed verification.

Trigger detection (any one suffices):
- `git diff --name-only origin/main..HEAD` includes paths under `client/`, `apps/*/index.js` with client export, `docs/`, `*.html`, shader files, or any file imported by a browser entry.
- New/changed export consumed by `window.*` or rendered in DOM/canvas/WebGL.
- Visual, layout, animation, input, network-on-page, or shader behavior altered.

Required protocol:
1. Boot the real server (or open the static page) on a known URL — witness HTTP 200.
2. `exec:browser` → `page.goto(url)` → wait for app init (poll for the global the change affects, e.g. `window.__app.<system>`).
3. Probe via `page.evaluate(() => …)` — assert the specific invariant the change was supposed to establish (instance counts, scene meshes, DOM nodes, render stats, network frames, etc.).
4. Capture the witnessed numbers in the response. "Looks fine" is not a witness.
5. Failures → regress to `gm-execute` (logic) or `gm-emit` (output) — never paper over.

Long-running probes: split into navigate-call → `exec:wait N` → probe-call to stay under the per-call budget. Do not stack multi-second `setTimeout` inside one `exec:browser` invocation.

Exempt only when: change is server-only with zero browser-facing surface, OR repository has no browser surface at all (pure CLI/library). Tag the exemption in the response with the reason; do not silently skip.

## INTEGRATION TEST GATE

```
exec:nodejs
const { execSync } = require('child_process');
try { execSync('node test.js', { stdio: 'inherit', timeout: 30000 }); console.log('PASS'); }
catch (e) { console.error('FAIL'); process.exit(1); }
```

Failure → regress to `gm-execute`. No test.js + testable surface → regress to `gm-execute` to create it.

## GIT ENFORCEMENT

```
exec:bash
git status --porcelain
git log origin/main..HEAD --oneline
```

Both must return empty. Local commit without push ≠ complete.

## CI — AUTOMATED

Stop hook watches all GitHub Actions runs for the pushed HEAD. Do not call `gh run list` manually.
- All-green → Stop approves with CI summary in next turn context
- Failure → Stop blocks with run names+IDs → investigate with `gh run view <id> --log-failed`, fix, push, hook re-watches
- Deadline 180s (override `GM_CI_WATCH_SECS`) → slow jobs get "still in progress" approve

## HYGIENE SWEEP

Before declaring complete:
1. Files >200 lines → split
2. Comments in code → remove
3. Scattered test files (.test.js, .spec.js, __tests__/, fixtures/, mocks/) → delete, consolidate into root test.js
4. Mock/stub/simulation files → delete
5. Unnecessary doc files (not CHANGELOG/CLAUDE/README/TODO.md) → delete
6. Duplicate concern → snake to `planning` with restructuring instructions
7. Hardcoded values → derive from ground truth
8. Fallback/demo modes → remove, fail loud
9. TODO.md → empty/deleted
10. CHANGELOG.md → has entries for this session
11. Observability gaps → server subsystems expose `/debug/<subsystem>`; client modules register in `window.__debug`
12. Memorize → every fact from verification handed off via background Agent(memorize) at moment of resolution
13. Deploy/publish → if deployable, deploy; if npm package, publish
14. GitHub Pages → check `.github/workflows/pages.yml` + `docs/index.html` exist; invoke `pages` skill if absent
15. Governance stress-suite → walk change through M1,F1,C1,H1,S1,B1,A1,D1; any flunk = regress to owning phase

## MEMORIZE

```
Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<fact>')
```

One per fact, parallel, same turn resolved. End-of-turn self-check mandatory.

## COMPLETION DEFINITION

All: witnessed e2e | browser_validated (when client work touched) | failure paths exercised | test.js passes | .prd deleted | git clean+pushed | CI green | hygiene sweep clean | TODO.md gone | CHANGELOG.md updated

**Never**: claim done without witnessed output | claim done on a client change without browser-validation witness | stop while .prd has items | skip hygiene | skip test.js | uncommitted/unpushed work | stop at first green
