# 02-PROVE — gm-codeinsight-bin-skipdir (session orch-main-r95)

Precondition: index complete. Both witness dispatches report codeinsight_index.complete:true, files_deferred:0.

Witness (dispatched by session orch-main-r95-w1, cwd C:/dev/gm — not a self-witness):
1. dispatch 1791662987881-500-f8d61eda46283248 — codeinsight outline bin/gm-install.js
   -> symbol_count 21, focus.state covered, complete true, lang javascript, loc 218.
   Corroborated by this session: dispatch 1791662765972-500-175dbb77840606d1 (same probe, 21 symbols,
   complete true, files_deferred 0) and dispatch 1791661586169-500-85a69e5ef08af0e1.
2. dispatch 1791663291922-500-86f67cee7c25b9f2 — codeinsight outline site/theme.mjs
   -> ok false, error "path not indexed: site/theme.mjs; near matches: "
   Corroborated by this session: dispatch 1791662877347-500-3de21dc1a76d373b (same result).
   site is a build-output segment in SKIP_DIRS with no SOURCE_DIR_SEGMENTS ancestor, so it stays skipped.

Invariant: a bin/ JS source file is covered by the code index; a true build-output file is not.
Postcondition: acceptance holds — "outline of a bin/ JS file returns its symbols instead of 0" (21, not 0)
and "true build-output directories stay skipped" (site/theme.mjs not indexed).

Second-project check: spoint bin/create-app.js focus.state covered (dispatch 1791662008105-500-728b7a8baaf4edf7),
and codesearch literal "vendorMcpBundle" returns ./bin/gm-install.js:48 and :213 (exhaustive true).

Root cause named by the row: REFUTED. rs-plugkit code_index.rs SKIP_DIRS (240-343) has no "bin";
line 283 is "obj". No edit is warranted on that surface.
