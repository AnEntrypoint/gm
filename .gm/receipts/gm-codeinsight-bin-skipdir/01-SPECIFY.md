# 01-SPECIFY — gm-codeinsight-bin-skipdir (session orch-main-r95)

Row (C:/dev/spoint/.gm/prd.yml:32050, dispatch 1791662522377-500-34e10fdb906968de):
- subject: "codeinsight does not index bin/: bin is in SKIP_DIRS in the rs-plugkit code index, so JS source under bin/ is never indexed"
- acceptance: "On the live build, codeinsight outline of a bin/ JS file returns its symbols instead of 0, and true build-output directories stay skipped."
- cited root cause to verify first: "SKIP_DIRS in the rs-plugkit code index, about line 283"

Cited line checked against the tree:
- rs-plugkit/crates/plugkit-core/src/code_index.rs:283 is "obj"; SKIP_DIRS (240-343) holds no "bin" entry.
- Whole-word literal "bin" in code_index.rs: 1 hit, line 4257 (BINARY_EXTENSIONS). has_binary_extension (4261) requires a '.' in the last segment, so a directory named bin is not skipped.
- => the cited root cause is STALE; the row's premise does not hold in the tree.

Live skip of a `bin` directory that DOES exist in c:/dev/gm:
- agentplug-crux/src/skiplist.rs:11 — SKIP_DIRS contains "bin"; consumed by agentplug-crux/src/walk.rs SkipMode::ContentIngest (!is_skipped_dir_segment).
- agentplug-crux/src/lib.rs:23-28 — crux is wasm_ingest/pipeline/context/score/dedup, not codeinsight. Different consumer, different surface (submodule).
- rs-plugkit/gm-plugin does not exist (skills/gm-orchestrate/SKILL.md:86).

Unknowns: none that block. The crux divergence is filed separately, not worked here (row acceptance is about codeinsight).
