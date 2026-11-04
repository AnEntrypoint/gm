# gm-new rewrite on deoxidene: common brief

Read this whole file, then your own brief (named at the end of your prompt). Do only your brief.

## Where and how
- Repo: /workspace/gm-new, branch main, one shared checkout. It is LIVE: the running gm-new workers execute src/ and tools/ from it. Do not clone, do not create worktrees or scratch copies of the repo. Scratch files go under /tmp.
- Edit ONLY the directories your brief names, plus your own build directory build/<your-name>. Do not touch src/, tools/, skills/, .mcp.json, package.json, AGENTS.md, DESIGN.md, README.md, runs/, tasks/self.md, or other workers' directories. Read them freely.
- Do not commit and do not push. The orchestrator commits. Leave your files in the working tree.
- Do not use grep or find in a shell. Search with mcp__gm__run_code bodies (gm.grep, gm.search, gm.read_file), or with the Read tool. Shell is for building and running only.
- No comments in new code. Names carry the meaning. If a reason cannot be expressed in code, put it in your report, not in the source.
- Attribution is lanmower only. No Co-Authored-By or generated-by trailers anywhere.
- Do not open network listeners. Outbound process spawns and outbound HTTP through curl are fine.

## Contracts (read first; do not change them; if one is wrong, say so in your report)
- include/deoxidene/*.hpp: deoxidene's library. result.hpp gives deoxidene::Result<T, E>.
- native/include/gmnew/json.hpp: JSON Value, parse, dump, quote.
- native/include/gmnew/log.hpp: RunLog (runs/<id>/log.jsonl, append-only).
- native/include/gmnew/verbs.hpp: VerbInfo and the VerbTable interface.
- native/include/gmnew/host.hpp: HostServices, what a leaf can reach (native verbs and extra primitives).
- native/include/gmnew/leaves.hpp: LeafVerbs, the hot-reloaded JavaScript leaves in native/leaves.
- native/include/gmnew/proc.hpp: process spawn with timeout (proc::run, proc::shell).
- native/include/gmnew/runcode.hpp: run_body, the QuickJS-NG run_code engine.
- DESIGN.md section "Rewrite on deoxidene (2026-11-04)" holds the decisions. Read it.

## The spec
The behaviour to match is the Node implementation in src/ and tools/ (named per brief). Read the relevant functions and their comments, then write C++ that does the same thing with the same JSON field names, error texts and result shapes. Where the Node code is wrong, match it and note the bug in your report.

## Build and witness
- Configure once per build dir:
  cmake -S /workspace/gm-new -B /workspace/gm-new/build/<your-name> -G Ninja -DCMAKE_BUILD_TYPE=Release -DGMNEW_BUILD_TESTS=ON
- Build and test:
  cmake --build /workspace/gm-new/build/<your-name> && ctest --test-dir /workspace/gm-new/build/<your-name> --output-on-failure
- native/CMakeLists.txt adds every native/components/*/CMakeLists.txt. Leaves are JavaScript and have no CMake target. Add your directory only when its CMakeLists.txt is final and builds, so that the configure of every other worker stays green. If another worker's directory breaks the configure, do not fix it; report it.
- Your witness is the last lines of your build and ctest output, quoted in your report. Unbuilt code is not done.

## Report (your final message, 250 words at most)
- Files created or changed, with one line each.
- The build and ctest result lines, quoted.
- Deviations from the Node spec, and why.
- Anything blocked on another worker, and what you need from it.
- Gaps you did not finish.
