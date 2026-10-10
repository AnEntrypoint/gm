# 03-DECIDE — gm-codeinsight-bin-skipdir (session orch-main-r95)

Checked against the row's own words, not against a diff:
- "codeinsight outline of a bin/ JS file returns its symbols instead of 0" -> TRUE on the live build
  (witness dispatch 1791662987881-500-f8d61eda46283248, 21 symbols, complete index).
- "true build-output directories stay skipped" -> TRUE (witness dispatch 1791663291922-500-86f67cee7c25b9f2,
  site/theme.mjs "path not indexed").
- "Root cause ... SKIP_DIRS in the rs-plugkit code index, about line 283" -> REFUTED; that list has no "bin".

Decision: no edit on rs-plugkit. The premise the row asserts is false in the tree and the acceptance is
already met by the installed build; the row's cited rule is stale. Editing a skip list that does not contain
"bin" would be motion that does not reduce distance.

Residual divergence, routed to its own row rather than guessed into this one:
agentplug-crux/src/skiplist.rs:11 still skips "bin" for crux ContentIngest (different plugin, submodule).
Filed as gm-crux-skiplist-bin-diverges in c:/dev/gm (dispatch 1791663292491-500-dc34a9c5cdbe6a41).

Files changed by this run in c:/dev/gm: .gm/receipts/gm-codeinsight-bin-skipdir/* (create-only),
.gm/witness-log.md (one appended line), .gm/prd.yml (one new row). No source file edited, no test file
written, no raw git.
