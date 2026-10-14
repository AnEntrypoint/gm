# 07-RES

Failure modes: (a) the lease owner session is still gm-ach-20261014-01 and a probe under gm-prdall-20261014-04-k06 is refused. Not exercised here; the witness uses a different session. (b) The probe reply carries `next_dispatch_hint.reason: session_mismatch` as a hint, not as a refusal, since the node text is served. Partial failure: the readonly probe 1791958846656 returned no node text, which is expected for readonly mode and is not a failure of this row.
