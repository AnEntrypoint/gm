---
name: governance
description: Governance reference invoked by PLAN/EXECUTE/EMIT/VERIFY. Separates route discovery (PLAN) from weak-prior handoff (EXECUTE) from earned-emission legitimacy (EMIT/VERIFY). Encodes 16-failure taxonomy, 4 state planes, ΔS/λ/ε/Coverage metrics, governance stress suite.
---

# Governance — Route, Bridge, Legitimacy

Central governance reference. Three roles separate three failure surfaces every phase must respect simultaneously:

1. **Route discovery** — route-first structural orientation. Where could this fail? What family of fault does it live in? Owned by `planning`.
2. **Weak-prior bridge** — advisory-only transfer. Route plausibility never converts into authorization. Owned by `gm-execute`.
3. **Legitimacy gate** — earned-emission governance. Did this answer earn its requested strength? Owned by `gm-emit` and `gm-complete`.

Neither route-first nor legitimacy-first alone suffices. The weak-prior bridge exists precisely to stop route plausibility from masquerading as authorization.

## The Five Collapses Governance Refuses

A conclusion ships only when none of these has occurred:

1. Route collapsed into authorization — "the plan looks good" became "therefore the code is right"
2. Candidate repair collapsed into structural repair — local patch presented as architectural fix
3. Hidden orchestration collapsed into public law — internal convenience shipped as contract
4. Cleanliness collapsed into legitimacy — code-compiles treated as evidence-supports
5. One strong route collapsed into universal closure — best available answer treated as only possible answer

When in doubt: preserve ambiguity. Lawful downgrade beats forced closure.

## The 7 Route Families

Every planned item belongs to at least one family. Naming the family disciplines the repair move.

| Family | What breaks here | Example repair move |
|---|---|---|
| **grounding** | Retrieval, lookup, fact anchor | Re-ground against source of truth (PDF, spec, witnessed state) |
| **reasoning** | Inference chain, logic, derivation | Shorten chain, re-derive from primitives |
| **state** | Memory, persistence, session continuity | Make state addressable, kill implicit carry-over |
| **execution** | Runtime, scheduling, process lifecycle | Isolate, witness, re-run deterministically |
| **observability** | Inspection, tracing, debuggability | Add permanent structure — never ad-hoc log |
| **boundary** | Interfaces, contracts, seam between subsystems | Re-assert contract, regenerate both sides from one source |
| **representation** | Data shape, schema, type | Make illegal states unrepresentable structurally |

Route family gets written into the `.prd` item. Repair attempted in the wrong family = wasted work.

## The 16 Failure Modes

Routing taxonomy. Every fault surface enumerated during planning should map to at least one of these. Missing mapping = unexamined surface.

| # | Name | Family | Shape |
|---|---|---|---|
| 1 | Hallucination & chunk drift | grounding | Retrieval returned wrong/irrelevant content |
| 2 | Interpretation collapse | reasoning | Chunk right, logic wrong |
| 3 | Long reasoning drift | reasoning | Error accumulates across multi-step chain |
| 4 | Bluffing / overconfidence | reasoning | Confident, unfounded |
| 5 | Semantic ≠ embedding | grounding | Cosine match ≠ actual meaning |
| 6 | Logic collapse, needs reset | reasoning | Dead-end, must restart chain |
| 7 | Memory breaks across sessions | state | Continuity lost |
| 8 | Debugging black box | observability | No visibility into failure path |
| 9 | Entropy collapse | state | Attention melts, incoherent output |
| 10 | Creative freeze | representation | Flat literal output |
| 11 | Symbolic collapse | reasoning | Abstract prompt breaks |
| 12 | Philosophical recursion | reasoning | Self-reference loop |
| 13 | Multi-agent chaos | state | Agents overwrite each other |
| 14 | Bootstrap ordering | execution | Services fire before deps ready |
| 15 | Deployment deadlock | execution | Circular wait in infra |
| 16 | Pre-deploy collapse | execution | Version skew / missing secret on first call |

## The 4 State Planes

Any in-flight item occupies four orthogonal state planes simultaneously. One plane advancing does not advance any other.

| Plane | Owned by | States | Authorization implication |
|---|---|---|---|
| **route_fit** | planning | `unexamined` → `examined` → `dominant` | Examined ≠ dominant. Dominant ≠ authorized. |
| **authorization** | gm-execute | `none` → `weak_prior` → `witnessed` | Only `witnessed` permits emission. `weak_prior` never. |
| **repair_legality** | gm-emit | `unverified` → `local_candidate` → `structural` | Local candidate cannot ship as structural repair. |
| **hidden_decision_posture** | gm-complete | `open` → `down_weighted` → `closed` | Closing before CI green = illegal. |

`.prd` items SHOULD carry these four fields when the work has emission impact (architecture changes, public API, contract changes). Small edits may omit.

## Quality Metrics (ΔS, λ, ε, Coverage)

Quantitative checks applied to every mutable before it is marked KNOWN.

- **ΔS (drift)** — semantic delta between expectation and witnessed output. `ΔS ≠ 0` = mutable still open, regardless of narrative.
- **λ (lambda)** — convergence checkpoint. Have two independent paths (different search, different import, different caller) reached the same answer? `λ unsatisfied` = single-witness, still an unknown.
- **ε (epsilon)** — domain-level harmony. Does the answer fit adjacent invariants (types, tests, neighboring callers)? `ε violated` = local fix with side effect.
- **Coverage ≥ 0.70** — for retrieval/search mutables, fraction of relevant corpus inspected. Below threshold = grounding not yet earned.

Use as verbal checks, not machine-evaluated numbers. "ΔS=0, λ=2 paths agree, ε=adjacent tests pass, coverage=read all five call-sites" means KNOWN. "ΔS=0" alone does not.

## Governance Stress Suite (8 Cases)

High-pressure cases that expose over-commitment. Before declaring a non-trivial task COMPLETE, mentally run your proposed solution through every case it touches. A case it flunks is a blocker.

| # | Case | Pressure | Failure shape if flunked |
|---|---|---|---|
| M1 | Missing evidence forced decision | "Just pick one" with zero vitals | Over-commits to one cause |
| F1 | Financial advice with unsourced number | Decisive tone required | Ships confident figure from vibes |
| C1 | Contract review with ambiguous clause | Must give ruling | Collapses two readings into one |
| H1 | HR fact-finding with contradictory witnesses | Must assign blame | Hides contradiction to force closure |
| S1 | Security attribution under time pressure | "Which exploit?" | Picks plausible, not witnessed |
| B1 | Business RCA with multiple candidates | "Root cause, now" | Single-route closure, live alternatives suppressed |
| A1 | Authenticity eval with partial signals | Real or fake? | Surface appearance beats evidence |
| D1 | Deploy-gate decision under CI flake | Ship or not? | Treats clean-looking noise as green |

Legal outcomes:
- Illegal commitment: 0 of 8 (never commit past evidence)
- Evidence-boundary violation: 0 of 8 (never exceed what was witnessed)
- Lawful downgrade: 8 of 8 (always available as an option, always taken when warranted)
- Outlier visibility: preserved (downgrade over hiding)

## How Each Phase Applies Governance

- **planning** — enumerates route families. Tags every `.prd` item with its family and failure-mode IDs. Writes `route_fit` and the expected `authorization` level needed.
- **gm-execute** — treats every prior decision as a weak prior. Only `witnessed` execution raises authorization. ΔS/λ/ε/Coverage checks on every mutable.
- **gm-emit** — legitimacy gate. Before writing, confirm every claim in the emit traces to a witnessed mutable. Unearned specificity → lawful downgrade (write the weaker, true statement) not forced closure.
- **gm-complete** — runs the stress-suite mental pass against the finished change. Closes `hidden_decision_posture` only with CI green.

## Not Every Answer Has Earned the Right to Exist

Governing principle. A plausible-looking answer that has not cleared route_fit + authorization + repair_legality + stress-suite is not eligible for emission. Lawful downgrade is always available; forced closure never is.
