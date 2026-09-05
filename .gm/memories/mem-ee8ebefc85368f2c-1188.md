---
key: mem-ee8ebefc85368f2c-1188
ns: default
created: 1788635985251
updated: 1788635985251
---

rs-codeinsight profiling method and result: the analyzer's dominant cost was NOT tree-sitter parsing but git::analyze_git, four sequential blocking git subprocess spawns forming a near-constant serial floor independent of corpus size. Phase instrumentation localized it; guessing would have optimized the parallel parse loop, already a minority of runtime. Fix: spawn the four independent git children first, collect after, bounding the phase to the slowest call rather than the sum. Generalizable gm-method lessons: a cost that stays flat as corpus size grows is a fixed serial stage, not per-item work, so measure an empty and a tiny corpus to expose the floor before optimizing the obvious loop. Wall-clock A/B on a dev machine is dominated by filesystem cache state, so a naive before-then-after ordering produced an apparent large regression that vanished under interleaved A/B/A/B on the same cache state; always interleave and report medians over ten or more pairs. Verifying an optimization did not change output revealed the baseline was already nondeterministic against itself, so diff-vs-baseline is only a valid equivalence check after confirming the baseline is reproducible.
