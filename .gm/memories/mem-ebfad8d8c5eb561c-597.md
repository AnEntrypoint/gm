---
key: mem-ebfad8d8c5eb561c-597
ns: default
created: 1785430326683
updated: 1785430326683
---

rs-plugkit config.rs validate_git_ref rationale: validates a branch/tag/sha before it reaches a git fetch/clone --branch argv, since a ref is as attacker-controlled as the URL beside it and lands in the same argv. The leading-dash check is load-bearing: --upload-pack=<cmd> in a ref position is git's other documented arbitrary-command vector, and an argv array does not prevent it because the string is still parsed as an option once git sees the dash. Remaining rules mirror git's own check-ref-format restrictions, applied here rather than discovered as an opaque git failure three calls later.
