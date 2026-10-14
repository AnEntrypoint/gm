# 02-PROVE

Precondition: the probe session gm-drain-w2-323 differs from the lease owner session and from row session gm-prdall-20261014-04-k06. Met (ORACLEBIAS served under gm-drain-w2-323; the 1791963870224 reply carries `phase: ORACLEBIAS`).

Invariant: the served ORACLEBIAS node carries the rule, not only a payload.

Postcondition (expected value from the row acceptance text, recorded before the grep): the served instruction text contains the phrase "Every probe's expected value comes from the row's pre and post conditions".

Live run: dispatch 1791963870224-500-eb7c5eb13e4098b7. Output file `C:\dev\gm\.gm\exec-spool\out\instruction-gm-drain-w2-323-23256-1791963857945-3649.json`. Grep for that phrase returns a match in the `instruction` field. Observed = expected. PASS.

Limitation noted: the expected phrase was taken from the ORACLEBIAS text that the earlier readonly probe also cited, so it is the contract the row names, not a value copied from the probe's own output.

Leader probe result: the served node is present under a fresh session, so H1 (lease-scoped refusal) holds and H2 (missing node) is refuted.
