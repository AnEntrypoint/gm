# 01-SPECIFY

Row: ORACLEBIAS-REBUILD-SIDELOAD-witness-blocker-gm-prdall-20261014-04-k06 (session gm-prdall-20261014-04-k06). Run session: gm-drain-w2-323.

Acceptance: the instruction served for phase ORACLEBIAS under its own session contains the expected-value-from-contract rule.

Cited evidence checked: `rs-plugkit/crates/plugkit-core/src/orchestrator/instructions/lean_prose.rs` embeds the ORACLEBIAS prose (cited line 104). Prior failing probe 1791958885764-500-660f9e1e2962aeb7 returned session_mismatch with owner gm-ach-20261014-01.

ACH matrix (cells: C consistent, I inconsistent, N neutral)

| Evidence | H1 lease owned by another session blocks the probe | H2 ORACLEBIAS node text absent from the served instruction |
| --- | --- | --- |
| 1791958885764-500-660f9e1e2962aeb7 session_mismatch | C | N |
| 1791958846656-500-910baf5d3d4c3c24 readonly, no ORACLEBIAS node | N | C |
| 1791963870224-500-eb7c5eb13e4098b7 phase ORACLEBIAS served under gm-drain-w2-323 with node text | C | I |

Leader: H1. Probe: `instruction {phase:"ORACLEBIAS"}` under session gm-drain-w2-323. Under H2 the node would be absent for every session, so a served node under a fresh session separates H1 from H2.
