# WFGY core mechanism — technical basis

Source: direct fetches of `onestardao/WFGY` primary files (`core/WFGY_Core_Flagship_v2.0.txt`, `ProblemMap/wfgy-metrics.md`, `ProblemMap/glossary.md`, `OS/TXTOS.txt`, `archive/wfgy_1_0_sdk_archive/{README.md,wfgy_engine.py,bbmc.py,bbcr.py,bbam.py,bbpf.py}`). Every claim in `SKILL.md` and `honesty-and-provenance.md` traces to something quoted or paraphrased here.

## ΔS (delta-S)

Stated formula, consistent across `ProblemMap/glossary.md`, `ProblemMap/wfgy-metrics.md`, `core/WFGY_Core_Flagship_v2.0.txt`:

```
ΔS = 1 - cos(I, G)      # I = item/current-state embedding, G = ground/goal/anchor embedding
```

This is real, well-formed math if real embeddings are computed. It is not real math in the plain-prompt (`OS/TXTOS.txt`) usage path, because no embedding call happens there — see below.

Thresholds are given but **inconsistent across the project's own documents**: `core/WFGY_Core_Flagship_v2.0.txt` gives 4 zones (safe <0.40, transit 0.40-0.60, risk 0.60-0.85, danger >0.85); `ProblemMap/glossary.md` collapses to 3 zones (stable <0.40, transitional 0.40-0.60, high risk >=0.60); `ProblemMap/wfgy-metrics.md`'s production PASS/WARN/FAIL table uses yet a different cutoff (PASS <=0.45, not <=0.40). `OS/TXTOS.txt`'s own worked example produces `ΔS: 1.8` — outside every zone table the same document defines (max stated ceiling is "danger >=0.85"), with no acknowledgment that this breaks its own scale.

Constants in the core file's `[Defaults]` block (`gamma=0.618` — literally the golden ratio truncated — plus `theta_c=0.75`, `zeta_min=0.10`, `alpha_blend=0.50`, etc.) carry no derivation or citation anywhere in the source; this reads as aesthetic constant-picking, not empirical tuning.

## BBMC (real name in source: "Boundary-Bounded Memory Chunks" per glossary; "Semantic Residue Minimization" per TXTOS.txt)

Formula (`core/`, `bbmc.py`): `B = I - G + m*c^2` ("semantic residue"), computed in the archived SDK as vector subtraction plus an optional constant offset, then L2 norm. The `m*c^2` term is decorative (evokes mass-energy equivalence, has no real meaning here); with the core file's own default `m=0` it vanishes and the formula reduces to plain `I - G`.

**Portable pattern kept in this skill:** diff current state against a stated anchor/goal. This survives as qualitative comparison without needing real embeddings.

## BBPF ("Branch-Bounded Prompt Frames" per glossary)

Formula version is dressed in dynamical-systems notation (`x_{t+1} = x_t + sum V_i(...) + sum W_j(...) P_j`) with undefined terms — the least concretely specified of the three kept patterns. But the source also gives a real, checkable gate condition: "bridge allowed only if delta_s decreases AND W_c < 0.5*theta_c" — proceed down a candidate path only if it measurably reduces drift and stays within a stability bound.

The archived SDK's `bbpf.py` implements something concrete: generate `k` perturbed candidate vectors, score each by a stability function, prefer lower-deviation candidates.

**Portable pattern kept in this skill:** when a decision has real alternatives, generate more than one before committing; prefer whichever most clearly advances the stated goal.

## BBCR ("Break-Before-Crash Reset" per glossary/core; "BigBig Coupling Resolver" per TXTOS.txt — the source itself uses two different expansions of the same acronym, an internal inconsistency worth knowing about)

The most concretely specified and most honestly portable of the four. Real trigger condition (`core/`, `bbcr.py`): residue norm exceeds a threshold `B_c`, OR a stability function drops below `epsilon`. Real operation, directly implemented in the archived SDK's `collapse_rebirth` function: reset to a prior stable state, retry, bounded by `max_retries` (SDK default: **3**); after retries are exhausted, log a warning and return the last (unstable) state rather than looping forever. `OS/TXTOS.txt`'s own framing adds an explicit "ask the user" fallback when no clean resolution is found, rather than silently proceeding.

**Portable pattern kept in this skill:** checkpoint before risky steps; on detected real incoherence, revert and retry a bounded number of times (this skill recommends 2-3, matching the SDK's real default); after that, surface the unresolved issue explicitly rather than picking an answer anyway.

## BBAM ("Attention Modulation" per glossary) — real computation not portable, ported instead as delegated judgment

Real operation, confirmed in three different formula variants across three different documents (a genuine internal inconsistency in the source): rescaling attention weights or output logits by a factor derived from their statistical variance/spread, e.g. `logits * exp(-gamma * sigma(logits))` (archived SDK's actual implementation). This is a real operation, but it is defined on internal model tensors (attention weights, raw logits) that exist only inside a transformer's forward pass. A text-generating agent, reasoning only through the tokens it produces, has no way to read or compute this about its own internal state — it cannot see its own attention weights, and no instruction can make that computation real.

What survives honestly: the *symptom* this computation is meant to correct (an over-peaked, over-concentrated distribution of "attention," in the real mechanism's terms) has a directly observable analog in an agent's own output — output that has narrowed onto one aspect of a broader task and stayed there past the point of usefulness, repeating itself or over-elaborating one sub-point while leaving the rest of the task untouched. `SKILL.md` asks the calling agent to notice this in its own recent output and deliberately widen back out — explicitly framed as the agent performing, in plain judgment, the correction the real computation would perform mechanically on a real distribution, not as a claim that attention weights are actually being inspected.

## The one place real embedding-based computation of ΔS may actually happen

A LangChain/LlamaIndex adapter in the source repo reportedly does real cosine-distance monitoring/logging of retrieval results as an observability layer (found by research but not independently re-verified byte-for-byte). Even there it appears to monitor/log rather than actively reroute the pipeline. This requires an actual embedding model and vector-math library wired in — outside the scope of a pure prompting-based Claude Code skill, and not something this skill attempts to replicate.

## The base engine's self-monitoring loop (distinct from Avatar's later "dual closed-loop" design)

`core/WFGY_Core_Flagship_v2.0.txt` defines a trend classifier over consecutive ΔS values: compute the step-to-step change plus a rolling mean over the last (up to) 5 steps, then bucket the trajectory as convergent / recursive / divergent / chaotic based on the sign and magnitude of that change. This is a real, checkable procedure for "is this task's drift getting better or worse over time," independent of whether the underlying ΔS numbers are truly computed or self-estimated — the classification logic itself is sound either way.
