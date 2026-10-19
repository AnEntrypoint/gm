# Mining ledger

The conversation mining run used the shard range `sub1` through `sub8`. The transcript directories for those shards are not present on disk at audit time, so their launch cannot be witnessed from this checkout. This ledger lists which pending PRD rows cite each shard. The rows are the only source; no per-shard count or file list is recorded in any of them, so none is given here.

Source: pending rows read with `prd-list` (status pending) at the time of this audit. Resolved rows live in `.gm/prd-log.jsonl` and were not searched.

| Shard | Pending rows that cite it | Citation as the row writes it |
| --- | --- | --- |
| sub1 | none | Named only in the range text of `mine-shards-launched`, which cites no finding. |
| sub2 | none | |
| sub3 | none | |
| sub4 | `codemode-nullable-reply-fields`, `codemode-require-hint`, `codesearch-unproven-zero`, `git-identity-fallback`, `submodule-update-verb` | "12 hits in shard 4"; "Shard 4 a586a413:79"; "Shard 4 extra observation"; "Shard 4 and 8"; "Shard 4: 4 hits of raw git/gh and git submodule update" |
| sub5 | none | |
| sub6 | none | |
| sub7 | none | |
| sub8 | `codemode-nullable-reply-fields`, `codemode-require-hint`, `git-identity-fallback`, `git-substitution-table`, `timeoutms-doc` | "22 hits in shard 8"; "shard 8 S/agent-a14c2e81ebb76074e.jsonl:265"; "Shard 4 and 8"; "Shard 8: 5 bash-git-bypass denials"; "Shard 8: 8 refusals of timeoutMs=N" |

Shards sub1-sub3 and sub5-sub7 produced no cited row.

Whether the subagent reports for sub1-sub3 and sub5-sub7 were received is not recorded in any row, so this ledger does not infer it. The `mine-shards-launched` row names sub1 through sub8 as the shard range; it cites no finding.
