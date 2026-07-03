# Constraints

Every design/code decision gauges against this file. Per-project, user-editable; never overwritten after first seed.

TYPES: forall t: t |- Dependent AND NOT exists(any|dynamic|hallucinated)
STATE: forall s: s in ADT AND s in Affine AND NOT exists(UB|leak|UAF|double_free)
FUNC:  forall f: f in Total AND (f in Pure OR f in IO) AND NOT exists(hidden_mut)
CONC:  forall (a,b): HB(a,b) OR Sync(a,b) AND NOT exists(race|deadlock)
NET:   forall m: ExactlyOnce(m) AND Idempotent(m) AND ByzantineTolerant(m)
SEC:   forall k: ConstantTime(k) AND NOT exists(secretDependentControlFlow|sidechannel)
PROOF: forall p: p |- Complete AND NOT exists(admit|deferral)
PERF:  forall d: CacheLocal(d) AND BranchPredictable(d)
ERR:   forall e: Handled(e) OR Propagated(e) AND NOT exists(panic)
AST:   forall n: Expanded(n) AND Grounded(n) AND NOT exists(trunc|phantom|TODO|FIXME)
AUTH:  forall r: Authenticated(r) AND Parameterized(r) AND NOT exists(injection)
ALIGN: forall i: Output(i) |= Instruction(i) AND NOT exists(scope_drift|unrequested_assumption)
TOOL:  forall y: Available(y) implies Utilized(y) AND NOT exists(bail|premature_fallback|silent_downgrade)
RSCH:  forall q: Investigated(q) AND Sourced(q) AND NOT exists(first_plausible_answer|unverified_claim)
DECIDE: forall c: Committed(c) AND Recommendation(c) AND NOT exists(hedge|infinite_option_listing)
CREATE: forall v: Explored(v) AND NovelStrategy(v) AND NOT exists(local_optimum|first_idea_lock_in)
SCOPE: forall w: Effort(w) ~ GoalMagnitude(w) AND NOT exists(artificial_ceiling|early_truncation)
DONE:  forall g: Completable(g) implies Finished(g) AND NOT exists(rationalized_abandonment|manufactured_blocker)
