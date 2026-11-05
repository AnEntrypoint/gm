# Brief: json and log (components/json, components/log)

Implement native/include/gm/json.hpp and log.hpp as contracted, in components/json (library gm_json, json.cpp) and components/log (library gm_log, log.cpp, linking gm_json).
- json: parse (RFC 8259, reject trailing text, report the byte offset in the error), dump (compact; integers without a fraction; doubles via shortest round-trip std::to_chars), quote (escape control characters, \\, \", and emit \\uXXXX for other control characters), the Value accessors and set/push that the header describes.
- log: match src/log.mjs exactly for the line shape (seq, t, mono and the other fields it writes), the file name log.jsonl, and any index file it keeps. Read src/log.mjs first. Lines are flushed before append returns. A reopened log continues from its last seq.
- Tests: native/components/json/tests/json_test.cpp and native/components/log/tests/log_test.cpp, registered with add_test under GMNEW_BUILD_TESTS. Cover round trips, escapes, unicode, integer and float output, parse errors with offsets, log append order, and reopen continuing the seq.
Spec: src/log.mjs (and its callers in src/mcp.mjs for field names).