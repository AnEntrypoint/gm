# RES
Failure mode: root-based recall may read the main daemon index instead of the copy (H3). Mitigation: caveat recorded in the witness line; a stronger witness would use a separate gm.db path, which the blocker row's own open note already calls out as unbounded indexing. Partial failure: a timeout keeps the dispatch running; resume_task applies. Not triggered (all calls answered within 20s).
Residual: first-call cost is bounded per slice, not per total passes; reported as a caveat, not a closure defect.
