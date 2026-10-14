STAGE: RES  row: CQS-gm-goal-w4-CQS-2
Failure mode: the row's premise is stale, so a rebuild would change nothing. Checked: the pure function and its caller are at the lines above. A future regression that moves the write back into capReplyText would appear as a writeFileSync hit inside 304-333, which the witness probe would catch.
