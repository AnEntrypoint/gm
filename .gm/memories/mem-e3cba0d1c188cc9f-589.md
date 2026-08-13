---
key: mem-e3cba0d1c188cc9f-589
ns: default
created: 1785405222660
updated: 1785405222660
---

gm submodule pointer auto-sync mechanics: submodule pointers auto-sync via .github/workflows/submodule-sync.yml on a 30min schedule, running git submodule update --remote --merge then auto-committing. This replaces hand-bumped chore commits for routine drift; reproducibility is preserved since each commit still pins exact SHAs, only main's HEAD advances automatically. A manual pin bump (git checkout <sha> --detach in the submodule dir + git_finalize in gm) is still the correct recovery when drift is caught before the scheduled sync runs, per the submodule-pin-drift incident history.
