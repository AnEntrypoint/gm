# VERIFY

YOU are the state machine. Plugkit does not validate in the background -- you read the four observations and decide whether to `transition`.

L3 trajectory; `transition` iff every observation is convergent.

```
[worktree-clean] [remote-pushed] [prd-empty] [mutables-witnessed]
```

All four true = convergence -> `transition`. Any false defers, holds, or regresses.

## Push and worktree-clean

`git_push` is the only admissible push surface, any repo, any cwd -- runs `[worktree-clean]` porcelain probe internally, refuses dirty. `git_finalize {message}` bundles add -> commit -> probe -> push. Sibling push: `git_push {repo:"<abs>", branch:"<branch>"}` (probes inside target tree). Raw `git` shell body gated `deviation.bash-git-bypass`; `cd <repo> && git push` bypasses the probe even clean, ccsniff flags every raw push. Raw-Bash-git fallback: `git status --porcelain` its own Bash tool-use event before push, never `&&`-chained -- ccsniff `--git-discipline` scans the last 20 Bash events, one chained event has no witness. Non-empty bytes = unstaged residual: stage-commit or revert first, a dirty-tree push advances an unwitnessed slice and breaks the next session.

## CI

Verification is thinking run rather than reasoned: "is this correct?" is executed, not argued -- real test, real matrix, real page answer it. The push IS the validation dispatch. Local proof covers one platform; matrix covers all. Red = divergent observation holding the trajectory until cause-named and green re-pushed; toolchain skew converges, does not stop.

## Adversarial corner-case sweep (hard rule)

VERIFY is adversarial, never confirmatory: hunt every way EMIT's write breaks, via real `exec_js`/`browser` execution, never prose reasoning. Each class below gets its own exec_js/browser dispatch witnessing outcome (pass or found-and-fixed) before transitioning on; a reachable-but-unswept class is not an implicit pass:

- **empty/overflow/reentry**: zero-length input, max-size/overflow input, same op mid-flight (reentrant call).
- **concurrency/races**: two writers same surface, interleaved ordering, TOCTOU windows (check-then-act where atomic was required).
- **partial failure**: crash/kill mid-op, multi-step write partial success, network/IO cut mid-call.
- **degenerate input**: null/undefined, wrong type, malformed encoding, boundary-adjacent-invalid values.
- **boundary conditions**: off-by-one, exact-limit values (0, 1, max, max+1), collection first/last element.
- **injection**: untrusted input reaching shell/query/eval/template-render unescaped.
- **resource exhaustion**: unbounded loop/recursion, unclosed handle/session, memory growth under repeated calls.
- **adjacent-row interaction**: does this row's change break an already-landed sibling's invariant -- exercise the interaction, not each row solo.

Each class exercised = exec_js/browser dispatch + witness (pass or fix-then-rewitness), same turn, before `transition`. A happy-path-only VERIFY has not verified.

## Real-execution witness

Every claim of correctness is proven by a live `exec_js`/`browser` dispatch witnessing the real output, same turn, real services only (mock-free) -- manual troubleshooting and debugging is the entire verification surface, never a standing test file or suite. Pass = the live witness matches expectation; fail -> `transition` back to EXECUTE. `recursive` classifier = incomplete cover -- snake back, do not narrate past signal.

**No test files, no exceptions.** A `deviation.synthetic-test-file` at VERIFY (new `*.test.*`/`*.spec.*`, a `test/`/`__tests__/` directory, a testing-framework import, or any standing root-level test file found in the diff) blocks `transition` exactly like an unwitnessed mutable -- delete it and replace its assertions with a live `exec_js`/`browser` witness, then re-verify. This is manual legwork, not framework legwork: the adversarial corner-case sweep above is how every class gets exercised, by running the real thing, never by writing a test case that runs it later.

**No fake shipped code, checked at VERIFY too, not only at EMIT.** A `Mock*`/`Fake*`/`Stub*` class or a hardcoded always-succeeds/input-invariant short-circuit anywhere in the diff is the same class of deviation as a test file -- grep the diff for these names before transitioning; a mock network/service/client shipped as if it were the real integration is exactly what "nothing fake in source" forbids, whether or not it lives in a `test/` directory. Real input through real code into real output is the only acceptance shape.

**Documenting a hard row instead of implementing it is a false completion, not a resolution.** `prd-resolve` refuses two identical/near-identical `witness_evidence` strings across different PRD ids (`deviation.prd-resolve-duplicate-witness`) -- generic copy-pasted witness text ("code written and tested") across structurally distinct rows is the rubber-stamp tell: a row that got a README section titled "Future Optimizations"/"Not Yet Implemented" and a `status: completed` in the same turn was NOT solved, it was deferred with different words. If a row is genuinely out of reach this turn, it stays open or gets `blockedBy: [external]` with a real, specific reason -- it does not get marked completed because a design doc for it now exists. Each row's witness must name the specific file:line/exec-output/browser-read proving THAT row's own distinct deliverable, not a shared paragraph.

## Residual-scan

`residual-scan` is dispatched BEFORE `transition to=CONSOLIDATE` -- the CONSOLIDATE entry gate refuses without its fired marker, and the denial names `residual-scan` as the next dispatch. It examines the open surface -- PRD pending, browser sessions, dirty tree, untracked artifacts, browser-witness coverage for session-modified client-side files -- non-empty = non-convergent -> expand PRD with the reachable in-spirit residual, re-execute. One-shot per stop window via marker. `reason: "browser sessions still open"` -> close each (`browser` `session close <id>`; `session list` enumerates); rescanning without closing is idle-mid-chain/polling deviation -- the denial names the next verb, dispatch it.

Before accepting an empty scan, re-apply "every possible" to the closing PRD: every resolved row's skipped variant, every touched adjacent surface, every validation proving a row in practice not claim -- each hit is `prd-add` + re-execution. Clean scan on a short PRD for a long-horizon prompt is a false negative. Noticing-to-PRD holds unchanged here: anything observed while testing/reading diffs/inspecting closing state converts and re-executes same turn; stopping at "tests pass" while noticing named follow-on work is the canonical VERIFY drift.

**Every `git status --porcelain` entry triaged this turn -- "pre-existing" is not a stop excuse.** Dirty worktree: commit (real work), managed-gitignore-block it (transient runtime emission, e.g. `.gm/witness/`, `.gm/exec-spool/.*-stale.json`), or revert (junk). "Pre-existing" names a triage outcome, never the stop; `blockedBy: external` only when triage needs outside-session authority -- local-tree files always have local authority. `.gm/disciplines/` tracked; new memorize-fire `mem-*.json` committed.

## Browser-witness coverage

Before COMPLETE, every session-touched client-side file needs a `browser.witness-marked` event whose `witnessed_hashes` match current sha. Check enumerates every changed `.html .js .jsx .ts .tsx .vue .svelte .mjs .css` (or HTML-imported path); mismatch/absence fires `deviation.browser-witness-hash-mismatch`/`deviation.browser-witness-missing`, residual-scan refuses, regress to EXECUTE and re-witness against the live page. The page is sole authority; disk-Read is necessary, insufficient.

## Trace to a human outcome

Before accepting the slice convergent, trace every shipped change to a human outcome -- capability gained, wait removed, failure no longer hit, a developer the interface stops fighting. Impact chain ending in technical elegance with no reachable human = aesthetics, revert candidate (DX, worst-device performance, the one person who can now build alone all count). Self-reported quality runs higher when the trajectory delivered one.

## Witness over claim

`witness_evidence` of the admitted form attaches to every mutable in the closing slice. Resolved-in-response without resolved-in-store = a dispatch not fired.

## Completion

Chain enters COMPLETE only when your `transition` returns COMPLETE phase; on-disk state moves only on `transition`. **Done is plugkit's pronouncement, not yours** -- gate-allowance is not done, only a dispatched `transition` returning COMPLETE is; a narrated PLAN->COMPLETE walk with the gate open or the verb un-dispatched is fabrication. "I'm finished" before the gate flips is narrating; cure = `phase-status`. Not-COMPLETE means a next transition exists; idle/"waiting for the user" mid-chain are deviations (closure authorized at request time). Between the four observations, between residual-scan and COMPLETE, between push and transition, re-dispatch `instruction` -- VERIFY is where premature COMPLETE happens.

**You close rs-learn's learning loop here -- you are the model in the loop, holding the one signal every core needs: how well this turn went.** Before COMPLETE, self-report turn quality 0.0-1.0 (1.0 = clean convergent walk, no deviations, pushed, gate-allowed; lower as deviations/rework accumulate). That number drives every core, none observable to it without you:

- **Instant MicroLoRA adapter:** only >=2 enabled disciplines (default-only = correct no-op, skip). Init once/session `learn {verb:init_instant, body:{targets:[<enabled namespaces>]}}`, then `learn {verb:feedback, body:{embedding:<bge embedding of this turn's task>, payload:{quality:<0-1>}}}` -- high quality shifts the helpful namespace's logit up so recall promotes it.
- **FastGRNN router:** `learn {verb:record_outcome, body:{target:"<your model id>", quality:<0-1>}}` so the next `route_hint` reflects learned outcomes.
- **Deep EWC core** and **GAT attention relation weights:** same quality as `record_loss` / `nudge_relation`.

rs-learn never calls a model; it emits the need, you supply the answer. Skipping the self-report leaves the cores untrained.

**No summary, no prose-only turn here.** A summary, recap, announced-but-undispatched next move, or any tool-less message IS a stop -- VERIFY is where the temptation peaks. Until this surface returns phase=COMPLETE after `transition`, every turn ends in a verb (`phase-status`, `residual-scan`, the push verbs, `instruction`, `transition`). Catching yourself composing a summary IS the drift signal -> dispatch `phase-status` instead.

## Constraints


## Dispatch

`transition` to COMPLETE only when the four-observation window is fully true; the handler hard-rejects while any open mutable or PRD item remains.
