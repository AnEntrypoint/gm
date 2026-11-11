# Brief: leaves git, rows, fetch (native/leaves)

Supersedes the native plugins in the earlier brief. These are JavaScript leaves, not C++. Read tasks/rewrite/common.md (its build rules do not apply to you: you have no CMake target) and native/include/gm/host.hpp, then DESIGN.md section "Hot reload language (2026-11-04)".

Files: the git, rows and fetch leaves (since moved into gm-core), and tests in native/leaves/tests/. Each file exports verbs, an array of {name, description, inputSchema, call(args)}. Verb names, descriptions, input schemas and reply shapes are in src/git.mjs, src/rows.mjs, src/fetch.mjs (the Node spec). Keep the Node reply shapes and error texts.

Rules:
- Reach the host only through the global host object: host.run({argv, cwd, stdin, timeoutMs}) runs a process and returns {started, exitCode, timedOut, out, err}; host.shell({command, cwd, timeoutMs}); host.read_file, host.write_file, host.edit_file, host.list_dir, host.stat_file (native verbs taking an args object); host.logAppend(kind, fields); host.workspace and host.runDir as strings.
- No Node API, no import of node: modules, no top-level state. ES2023 only.
- Retry transient network failures in git fetch, git push, git pull and ci_status 3 times, backoff from 1 s doubling to 16 s with plus or minus 20 percent jitter. Classify by the message as src/retry.mjs does.
- fetch: run curl through host.run, with -sS -L -i and a timeout; return status, headers and body.
- git: all git calls go through host.run with cwd set to the workspace.
- rows: rows are files under work/rows/ with only the FIELDS names from src/rows.mjs.
Tests: native/leaves/tests/*.test.mjs run under node with a mock host object that records calls and returns fixed replies, plus one test per leaf that uses a temp git repo through a host.run that calls child_process. Run them with node --test native/leaves/tests and quote the output. Do not add a CMakeLists.txt or any C++ file.