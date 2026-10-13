# gm: rationale, anchors and measurements

Companion to `skills/gm/SKILL.md`. The imperatives live in SKILL.md; this file keeps the reasons, the technique catalogue (Section 3) and the dated measurements behind them. Section numbers match SKILL.md.

## Section 1: harness rationale

- Bare state checks use `phase-status`, not `instruction`: `phase-status` returns only the compact phase-history struct, while `instruction` also composes the full entry+phase prose block plus recall/orient data on every call, often 1000+ words an agent already holds.
- Start rationale: a recent timestamp only proves that a process wrote once, so the timestamp alone never proves liveness. A `ts` that is recent but not this second is a BUSY watcher: its heartbeat oscillates while one dispatch occupies it. Starting another process then gives the project two sweepers that cannot see each other's claims, so each one's orphan sweep answers `dispatch_orphaned` for the other's running work and deletes the claim under it. That is the `dispatch_orphaned` storm with a rotating `sweeping_pid`. Seven concurrent watchers were observed on one project this way.
- Missing out-file rationale: concluding "verb unavailable" from silence has cost real sessions whole turns, falling back from verbs that were served and answering normally (`git_log` among them). A cold codesearch index/embed pass or a contended daemon legitimately takes minutes.
- Runtime-state exception rationale: `find`, `Glob` and `Grep` for content search are blocked because an agent invoking them can walk an entire filesystem uncached and unbounded on every call, where `codesearch` is a purpose-built, cached, incremental index. The ban is a resource and blast-radius boundary, not a preference between equivalent tools.
- Unscoped-scan rationale: a scan subagent returns only located `path:line` lines, so the orchestrator keeps the locations and never the match text.
- Every Agent/Task dispatch opens with the brick-wall opener because a fresh subagent inherits none of this file's prose and defaults to its native Grep/Glob/find/raw-git tools.

## Section 1a: supply chain

- The `scan_deps` mechanism (body params, `node_modules` walk bounding, hit-escalation rules for the "HiddenSpawn"-class obfuscated dropper) is served prose at SPECIFY, arriving automatically with every SPECIFY-phase `instruction` response.

## Section 3: anchors (technique catalogue)

This catalogue lists techniques by purpose. The served prose for each phase names the techniques that phase uses, and that prose is authoritative. Secure is this file's addition, exercised inside whichever phase touches a trust boundary.

Take the state's purpose from its served prose. If that prose carries a named-technique catalogue, use it and add nothing. Otherwise draw below only where the state's purpose and this project's substrate match the anchor's domain. No match is expected and normal -- run on Section 2. An anchor never overrides a gate.

**Frame** -- XY Problem; Naur; Cynefin (Snowden); Spike Solution (Beck); First Principles; JTBD (Christensen). XY check: restate the stated request and the problem it serves; when they differ, re-scope the row to the real problem before any edit.

**Specify** -- EARS; INVEST; Cockburn Use Cases; Quality Attribute Scenario; MoSCoW; Impact Mapping; Definition of Done.

**Change** -- Mikado Method; small batches (Reinertsen); characterization behaviour (Feathers), witnessed live before the first edit: each touched function's current behaviour is recorded by a live dispatch first, and no edit starts until that record exists; Boy Scout Rule (Martin); Opportunistic Refactoring and Rule of Three (Fowler); Broken Windows (Hunt & Thomas); DRY; Code Smells; Strangler Fig; SOLID; Deep Modules (Ousterhout); SLAP; Chesterton's Fence; Hyrum's Law.

**Verify** -- Boundary Value Analysis and Equivalence Partitioning (Myers) applied by hand to real inputs; property-based and mutation reasoning (Claessen & Hughes; DeMillo) as live exploratory execution; Residuality Theory (O'Reilly); Fallacies of Distributed Computing (Deutsch); Red/Green (Beck) executed live against the running system, where the Red expectation is a witness row recording the output the request implies, written before the Green change; Fagan Inspection re-reading the request's literal words against the live-witnessed behavior, not the fix's own diff; Shewhart and Nelson Rules; Devil's Advocate. No test files, ever (predicate `no-synthetic-test-files`, `gm-config/fsm/predicates.md`).

**Secure** -- Least Privilege and Fail-Safe Defaults (Saltzer & Schroeder); STRIDE; OWASP Top 10; LINDDUN. Credentials are asymmetric: no revert reaches a log or mirror.

**Correct** -- Jidoka and Five Whys (Ohno); Poka-Yoke (Shingo); Circuit Breaker (Nygard); Feynman; Popper.

**Decide and stop** -- Occam's Razor; Last Responsible Moment (Poppendieck), which defers decisions, never work; YAGNI; Second System Effect (Brooks); Hemingway Bridge.

**Disclose** -- BLUF; Minto; ADR (Nygard); MADR; Conventional Commits; 50/72.

## Autonomy: measurements

- Shared work tree, measured 2026-10-12 in C:/dev/gm (lane a48ac11a): local main `09575d5d` against remote main `538a0c80`, twelve unpushed local commits, each from a `git_finalize` that refused to push over ~150 `clashing_paths` while the same content was already published. Each refused push left a local commit redundant with the published one and widened the gap between local HEAD, the work tree and remote main. That gap makes a HEAD-only check call a file absent, a pin stale, and trips `git_finalize`'s own `dangling_reference` gate.
- Admission band: measured in the shared plugin pool, a single `git_push` blocked on a remote held a third of the admission band for 1417734 ms while every `codesearch`, `git_status` and `fs_write` in every project waited out its patience budget (120 s cheap, 180 s heavy). The phantom hold: `lane_holds` in `.dispatch-wait.json` reads empty while the daemon stalls, because the hold is a counter in the pool and not a lane. The full pool rule is defined in gm-orchestrate.
- Commit author and trailers, measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main-gm-notrailers): three published commits on `AnEntrypoint/spoint` main carried `Co-Authored-By: Claude Code <noreply@anthropic.com>` inside the author line `lanmower` (`f332304c6f` among them).
- Collision recovery: a collision recovered on main is cheaper than an isolated checkout, which costs a merge that sweeps every lane's uncommitted edits.

## Section 1: informational notes (not rules)

- The runner updates itself in the background on its own schedule once running (binary and plugins alike). That update path never touches the gm skill or the session.
- The verb set is the registry that `dispatch health` answers.
