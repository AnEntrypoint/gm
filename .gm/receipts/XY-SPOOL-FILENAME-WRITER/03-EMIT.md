# 03 EMIT -- XY-SPOOL-FILENAME-WRITER

One exact-match edit: skills/gm/spool-adapter.md, the paragraph after the atomic-write rule.
Before: "Write the in-file atomically: write the body to a sibling temp name, then mv it onto <N>.txt" with no statement of where to stage it.
After: stage the temp OUTSIDE in/, e.g. .gm/exec-spool/.staging/<N>.txt, and rename it into in/<verb>/; the sweep and its answer are named;
the 2026-10-10 measurement over 24 projects is cited (279 quarantined, 30 of them temps staged this way, latest named, each with a rejection answer and no dispatch out-file);
a second paragraph records that the sweep is not a poll (cold sweep on new root attach, or sweep-spool <root>) with the live 3 s / after-sweep measurement.

Witness through the live entry point: dispatch 1791672650688-500-10d4a22f479e6f5f (session orch-main-r169-sub1, RESULT: PASS).
The prose rule itself was kept, not cut: pending row BLOCKER-SKILLGM-spool-final-name-claim says prose stays until the claim-side fix lands.