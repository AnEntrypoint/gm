# 08-DECIDE: LIVEPLAN-RETIRE-XYPROB-RUNTIME-STATE

Decision: the closing condition is met by live witnesses (AUDIT completed, IGNORE completed). Resolve the row with the AUDIT prd-list dispatch as witness_dispatch_id, cite the IGNORE dispatch in witness_evidence, and resolve XYPROB as superseded in the same run.
Push/CI: no source change, so CI is not a gate for this state change. Publish of .gm log paths is reported in DELIVERY.
