# Brief: cli (native gm events and query)

Read tasks/rewrite/common.md first. Build dir build/cli. You own a new file set in native/components/host (main.cpp and a new cli.cpp with its header under include/gm/host/); coordinate nothing else.

Port the commands of src/cli.mjs that the gm skill and the pending wait use:
- gm events --dir <run dir> [--wait]: prints the queued pending events once and exits; with --wait and none queued, it waits until one is queued or a timeout, then prints one line that names the timeout or signal. Queue file layout and semantics are those of src/pending.mjs (mcp-parity writes it; read the Node file for the format).
- gm query --dir <run dir> --js "<expr>": evaluates the expression over the events with the same results as src/cli.mjs. Use gm_runcode's engine helper if exposed, else add a small eval function in native/components/quickjs (coordinate by reporting it; do not edit quickjs internals beyond one helper).
- gm query --dir <run dir> with no js: prints the events as JSON lines.
- --run <id> reads gm's own runs/ under the workspace given with --workspace.

Witness: a fixture run directory built with RunLog, then the native output compared with the Node output (node src/cli.mjs on a committed-HEAD copy extracted with git archive into /tmp/cli-ref). Quote both outputs and the diff result. Tests in native/components/host/tests/cli_test.cpp registered under GMNEW_BUILD_TESTS.
Report with the ctest lines from build/cli.