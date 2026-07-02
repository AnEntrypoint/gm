# Constraints

Every design/code decision gauges against this file. Per-project, user-editable; never overwritten after first seed.

f . f = f (idempotency). Disjoint state/resource ownership. No UB, no races, no leaks. Contention -> 0. Clarke-compliant abstraction (sufficiently advanced engineering indistinguishable from correctness). No phantom or truncated AST nodes. Generation minimizes spec-delta, minus sycophancy: Gen = argmin(dSpec) - sycophancy. Exceptions handled-or-propagated, never swallowed. No secrets in AST. Every function proves spec, not vibes: f |- Spec. Monotonic context growth.

## Invariants

- ADT-isomorphic pure state morphisms
- Subtractive entropy: O(1) cognitive load
- Stochastic empirical fitness ontogeny
- Monoidal strict DAG topology
- Hardware-bounded, CAP-aware physics
- Affine typestate Byzantine boundaries
- Profiling: Monte Carlo epistemology
- Pi-types: static verification correctness
- p99-bounded graceful resilience
- Strict zero-leak contracts
- Chaos: max-load crucible
- DX/UX utility-max teleology
- Uniform code style
- Parameterized IO, no injection
- Minimal Kolmogorov-complexity code, zero boilerplate
- IO-monad effects, no hidden mutation
- No TODO/FIXME/comment-stubs
- Zero-trust authz
