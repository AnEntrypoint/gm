# Mining ledger

Mining run used shard range `sub1` through `sub8`. Transcript dirs for those shards absent on disk at audit time, so launch not witnessed from this checkout. Ledger lists which pending PRD rows cite each shard. Rows only source; no per-shard count or file list recorded in any, so none given here.

Source: pending rows read via `prd-list` (status pending) at audit time. Resolved rows in `.gm/prd-log.jsonl`, not searched.

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

Shards sub1-sub3 and sub5-sub7 cite no row.

Whether subagent reports for sub1-sub3 and sub5-sub7 received not recorded in any row, so ledger doesn't infer it. `mine-shards-launched` row names sub1 through sub8 as shard range; cites no finding.