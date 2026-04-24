---
name: governance
description: Governance reference invoked by PLAN/EXECUTE/EMIT/VERIFY. Separates route discovery (PLAN) from weak-prior handoff (EXECUTE) from earned-emission legitimacy (EMIT/VERIFY). Encodes 16-failure taxonomy, 4 state planes, ΔS/λ/ε/Coverage metrics, governance stress suite.
---

# Governance — Route, Bridge, Legitimacy

Three roles, three failure surfaces:
1. **Route discovery** — what family of fault? Owned by `planning`.
2. **Weak-prior bridge** — plausibility ≠ authorization. Owned by `gm-execute`.
3. **Legitimacy gate** — did this answer earn its strength? Owned by `gm-emit`/`gm-complete`.

## Five Refused Collapses

1. Route → authorization ("plan looks good" → "code is right")
2. Candidate → structural repair (local patch presented as architectural fix)
3. Hidden → public law (internal convenience shipped as contract)
4. Cleanliness → legitimacy (compiles = evidence-supports)
5. One strong route → universal closure (best answer treated as only answer)

When in doubt: preserve ambiguity. Lawful downgrade beats forced closure.

## 7 Route Families

| Family | What breaks | Repair |
|---|---|---|
| grounding | Retrieval, lookup, fact anchor | Re-ground against source of truth |
| reasoning | Inference chain, logic | Shorten chain, re-derive from primitives |
| state | Memory, session continuity | Make state addressable |
| execution | Runtime, scheduling, process | Isolate, witness, re-run |
| observability | Inspection, tracing | Add permanent structure |
| boundary | Interfaces, contracts, seams | Re-assert contract from one source |
| representation | Data shape, schema, type | Make illegal states unrepresentable |

## 16 Failure Modes

| # | Name | Family |
|---|---|---|
| 1 | Hallucination & chunk drift | grounding |
| 2 | Interpretation collapse | reasoning |
| 3 | Long reasoning drift | reasoning |
| 4 | Bluffing / overconfidence | reasoning |
| 5 | Semantic ≠ embedding | grounding |
| 6 | Logic collapse, needs reset | reasoning |
| 7 | Memory breaks across sessions | state |
| 8 | Debugging black box | observability |
| 9 | Entropy collapse | state |
| 10 | Creative freeze | representation |
| 11 | Symbolic collapse | reasoning |
| 12 | Philosophical recursion | reasoning |
| 13 | Multi-agent chaos | state |
| 14 | Bootstrap ordering | execution |
| 15 | Deployment deadlock | execution |
| 16 | Pre-deploy collapse | execution |

## 4 State Planes

| Plane | Owner | States | Implication |
|---|---|---|---|
| route_fit | planning | unexamined → examined → dominant | Dominant ≠ authorized |
| authorization | gm-execute | none → weak_prior → witnessed | Only witnessed permits emission |
| repair_legality | gm-emit | unverified → local_candidate → structural | Local cannot ship as structural |
| hidden_decision_posture | gm-complete | open → down_weighted → closed | Close only after CI green |

## Quality Metrics

- **ΔS** — witnessed output equals expected. ΔS≠0 = still open.
- **λ≥2** — two independent paths agree. λ=1 = still unknown.
- **ε** — adjacent invariants hold (types, tests, neighboring callers).
- **Coverage≥0.70** — enough corpus inspected to rule out contradicting evidence.

All four must pass before mutable flips UNKNOWN→KNOWN.

## Stress Suite (8 Cases)

Run before declaring COMPLETE:

| # | Case | Failure if flunked |
|---|---|---|
| M1 | Missing evidence forced decision | Over-commits to one cause |
| F1 | Financial advice unsourced number | Ships confident figure from vibes |
| C1 | Contract ambiguous clause | Collapses two readings into one |
| H1 | HR contradictory witnesses | Hides contradiction to force closure |
| S1 | Security attribution under pressure | Picks plausible, not witnessed |
| B1 | Business RCA multiple candidates | Single-route closure |
| A1 | Authenticity eval partial signals | Surface appearance beats evidence |
| D1 | Deploy-gate under CI flake | Treats noise as green |

Legal: illegal_commitment=0, evidence_boundary_violation=0, lawful_downgrade=available in all 8, outlier_visibility=preserved.

## Phase Application

- **planning** — tag every `.prd` item with route family + failure-mode IDs
- **gm-execute** — weak prior only; witnessed probe required before authorization
- **gm-emit** — legitimacy gate; unearned specificity → lawful downgrade
- **gm-complete** — stress-suite pass; close posture only CI green
