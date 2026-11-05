# Brief: host binary and relay (components/host)

Supersedes the native plugin loader in the earlier brief. Read tasks/rewrite/common.md and native/include/gm/host.hpp, leaves.hpp and verbs.hpp, and DESIGN.md section "Hot reload language (2026-11-04)".

1. Binary gm (components/host, executable gm). Modes:
   - gm serve --workspace <dir> --runs <dir> --task <file> --skills <dir> --leaves <dir>: the relay. It holds the host stdio and runs gm worker as a child, forwarding lines both ways. It answers only when the worker is down.
   - gm worker (same flags): runs gm_mcp on its own stdio.
   - gm doctor: prints the ABI version, the leaves directory and each leaf's verb names.
2. Assemble HostServices in main: workspace, run_dir, native = a ComposedVerbs of CoreVerbs (components/verbs) and SearchVerbs (components/search), and extra with run (proc::run), shell (proc::shell) and logAppend (RunLog::append). ComposedVerbs is a VerbTable; a verb name in both is an error at startup.
3. Build the leaves with LeafVerbs (components/quickjs) over native/leaves. The run_code body gets the union of native verbs and leaf verbs through the same ComposedVerbs.
4. Relay restart: a change under components/ or include/ rebuilds the gm target with cmake --build (build dir from a flag) and restarts the worker from the new binary after the in-flight call is answered. A failed build keeps the old worker and logs the error. Leaves never trigger this path.
5. Delete nothing that is not yours. native/include/gm/plugin_abi.h is being removed by the orchestrator; do not build against it.
6. Witness: a test in components/host/tests: start the worker over pipes, run a next_context and a run_code that calls a leaf verb, edit the leaf file, call again, and check the new value is returned with no restart and LeafVerbs::generation increased. Quote the output.
Spec: src/hot.mjs (generation and restart semantics), tools/relay.mjs, tools/supervise.mjs, tools/core.mjs.