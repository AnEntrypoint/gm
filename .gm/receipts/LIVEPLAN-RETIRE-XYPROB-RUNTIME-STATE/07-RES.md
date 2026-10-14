# 07-RES: LIVEPLAN-RETIRE-XYPROB-RUNTIME-STATE

Failure modes:
- Stale IGNORE witness (2026-10-12): mitigated by the current AUDIT witness (2026-10-14) and the live prd-list read of the IGNORE row. Residual risk noted.
- Partial failure between the two prd-resolve calls: the row can close while XYPROB stays pending. Mitigation: run XYPROB resolve immediately after and re-read both rows with prd-list; if XYPROB is still pending, file a blocker row for it.
- Concurrent write to .gm/prd-log.jsonl by another lane: prd-resolve is compare-and-swap per file; a refusal is retried on the re-read state.
