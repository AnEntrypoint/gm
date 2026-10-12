# 10-DELIVERY — gm-witness-log-clobber-live-refusal

The push denial recorded in 08-DECIDE/09-COMPLETE did not stand: the second path-scoped
git_finalize auto-recovered it.

- git_finalize (dispatch 1791671136276-500-61ebf45be19741ad), paths
  .gm/receipts/gm-witness-log-clobber-live-refusal/ -> commit 173e182ffa496daf54722fcf0adee0b8f8770c2e.
  auto_recovered: true -- git_pull merged the remote's auto-bump
  58b9d40ba3834976f9ead1daee188e3e42715a51 ("chore: auto-bump version to 2.0.2837 [skip ci]"),
  producing merge 603c42d6420711e5172c3d1657ae5b165b1129f4, then pushed: true with
  remote_sha 603c42d6420711e5172c3d1657ae5b165b1129f4 == final_sha.
- The witness-log commit 541ddbadcbf15d6eda0c897270f55da9b28f871d is in that history:
  git_log {paths:[".gm/witness-log.md"]} (dispatch 1791671190589-500-219d15ed0b0fd189) lists it
  first, authored 2026-10-11T00:21:27+02:00 by lanmower. So the appended witness line is
  published, and local main equals origin/main at the merge.
- ci-status on 603c42d6420711e5172c3d1657ae5b165b1129f4: status success, one job
  (doc-drift / scan, run 38091363334, conclusion success), dispatch
  1791671169920-500-308e59f31856eff2; re-checked by session orch-main-r156-sub1, whose
  dispatch id is the witness bound to the blocker row's resolve.
- Blocker row gm-witness-log-clobber-live-refusal-blocker-orch-main-r156 was filed against the
  gate_denied remote_moved denial (prd-add 1791671071864-500-5fbf46b50b4e4ef2) and is closed
  now that the push landed and CI is green.

Nothing else is outstanding for this row. c:/dev/spoint untouched; .gm/prd.yml shared and
uncommitted; no source edit anywhere.
