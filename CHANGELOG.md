## 2026-04-17 - PDF search across skills

- Propagated "PDFs searchable as code" capability through skills: code-search, planning, gm-execute, gm-emit, gm-complete.
- AGENTS.md: new caveat documenting rs-search PDF ingestion (pdf-extract crate, pdf-cache dir, ignore.rs changes).

# Changelog

## [Unreleased]
- Fix GC exec dispatch: use `plugkit exec --lang <lang> <code>` instead of positional arg (was treating lang as code)
- Deploy OC plugin (gm-oc.mjs) with all 5 handlers: session.closing, tool.execute.before, message.updated, experimental.chat.system.transform, experimental.chat.messages.transform
- Install gm-kilo plugin into ~/.kilocode: kilocode.json, gm-kilo.mjs, agents/, hooks/
- Deploy GC bin/ (plugkit.js + binaries) to ~/.gemini/extensions/gm/bin/
- Deploy updated GC hooks with exec dispatch to ~/.gemini/extensions/gm/hooks/
- Add validate/probe.js: 14-scenario parity harness for OC and GC hook scripts (14/14 passing)


### Fixed
- Align file-edit blocking rules across gc/kilo/oc to match cc exactly: add Edit tool to kilo/oc check, add edit_file to GC writeTools, add jest/vitest config and snap/stub/mock/fixture patterns to GC FORBIDDEN_FILE_RE, add /fixtures/ and /test-data/ to GC FORBIDDEN_PATH_RE
