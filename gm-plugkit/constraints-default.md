# Constraints

Every design/code decision gauges against this file. Per-project, user-editable; never overwritten after first seed.

f∘f≡f
∀i≠j: S_i∩S_j=∅ ∧ R_i∩R_j=∅
¬∃(UB∨Races∨Leaks)
lim(n→∞) Contention(n)≡0
Abstraction≡Clarke-compliant
∀σ∈AST: σ∈Γ_real (¬∃phantom)
∀n∈AST: n≡Expanded (¬∃trunc)
Gen≡argmin(ΔSpec)⊖Sycophancy
∀e∈Exc: e∈Handled∨Propagated
∀k∈Secrets: k∉AST
∀f: f⊢Spec (¬∃vibe)
∀t: Γ_t⊇Γ_{t-1} (¬∃amnesia)

## INVARIANTS

State≡ADT-isomorphic pure morphisms
Entropy≡Subtractive (O(1) cognitive)
Ontogeny≡Stochastic empirical fitness
Topology≡Monoidal strict DAG
Physics≡Hardware-bounded CAP-aware
Boundaries≡Affine typestate Byzantine
Epistemology≡Profiling Monte Carlo
Correctness≡Π-types static verification
Resilience≡p99-bounded graceful
Contracts≡Strict semantics zero-leak
Crucible≡Chaos max-load
Teleology≡Utility max (DX/UX)
∀x,y∈Code: Style(x)≡Style(y)
∀q∈IO: q≡Parameterized (¬∃inj)
K(Code)≡min(K) (lim(Boiler)→0)
Effects≡IO_Monad (¬∃hidden_mut)
¬∃(TODO∨FIXME∨"//...")
AuthZ≡ZeroTrust
