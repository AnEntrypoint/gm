# 02-PROVE: LIVEPLAN-RETIRE-XYPROB-RUNTIME-STATE

Precondition: both split rows have status completed with a witness_binding. Verified by prd-list dispatches 1791958716240-500-4a665da134637583 (AUDIT) and 1791958720012-500-153812c737759772 (IGNORE).
Invariant: the parent XYPROB row is still pending and is the only row this run closes; its split children are not edited.
Postcondition: after prd-resolve of this row, prd-list {"id":"LIVEPLAN-RETIRE-XYPROB-RUNTIME-STATE"} shows it resolved, and XYPROB-runtime-state-in-submodules is resolved as superseded.
Run: each precondition was re-read live above; no edit was made.
