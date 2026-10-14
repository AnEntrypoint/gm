# 08-DECIDE

Decision: the time-box and discard rule stays in shipped phase prose at `gm-config/prose/lean-p1.md` (section SPIKE, lines 129-134). It does not move into `skills/gm/SKILL.md` section 3 (skills silent; SKILL.md has no spike text; gm-config owns phase prose). It is also not PRD-scoped only.

Claim verdicts:
- C1 (time-box lives only in PRD rows): refuted. The time-box is in `lean-p1.md:133`. The cited `SKILL.md:268` is stale (no such text).
- C2 (no skill states discard): holds. `skills/` has no discard or timebox statement (probe A, 0 hits). The discard rule is "Spike code is never shipped" in `lean-p1.md:133`.

Leader hypothesis: H1 (see 02-PROVE). Witness must name H1: dispatch 1791959311488-500-9e766a8e0fded2a6 (names lean-p1.md:133) plus 1791959318728-500-e38b1082168391b2 (skills silent).

Push/CI: no code pushed by this run. Delivery of receipts is a local state change only.
