# 01-SPECIFY: SPIKE-gm-goal-w3-SPIKE-1 (session gm-drain-w1-287)

Row: Spike principle, skills surface. Row claims:
- C1: a spike is time-boxed; the rule exists in PRD rows but `skills/gm/SKILL.md:268` names the principle only as an anchor label.
- C2: a spike answers one unknown and is then discarded; no skill states it.
- Close: decide whether the time-box rule belongs in `skills/gm/SKILL.md` section 3 Anchors or stays PRD-scoped.

Tree check of cited lines:
- `skills/gm/SKILL.md:268`: STALE. `codesearch` literal `Spike` on `skills/gm/SKILL.md` returned 0 hits (1 file, 131 lines read). The file contains no spike text at all. Dispatch 1791959272463-500-f0f642fb5812db03.
- Row's witness count (4 hits in `skills/dream-rsi/gm-graph.json`) is also stale: literal `SPIKE` over `skills` returned 12 hits. Dispatch 1791959240818-500-4fe90ac3f93417c4.

Hypotheses:
- H1 (leader): the time-box and discard rule is stated in shipped phase prose `gm-config/prose/lean-p1.md:133` (owned by gm-config per AGENTS.md Ownership). No skill file states it. Neither "PRD-only" nor "SKILL.md section 3" is the true location.
- H2: a skill file (`skills/**`) states the time-box or discard rule. Predicted to be refuted by a regex search of `skills`.
- H3: the rule lives only in PRD rows (row's C1 literal reading). Predicted to be refuted by `lean-p1.md:133`.

Discriminating probes: (a) regex `timebox|time-box|Time box|discard` over `skills` (H2); (b) literal `timeboxed` over `gm-config` (H1 and H3).

Scope: discovery row, no code change expected. Receipts only.
