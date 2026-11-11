# Native plan: every script, and where it goes

Scope: each script tracked in git (`git ls-files`) and each script in the install
(`~/.gmnew/versions/<id>/`). Destinations:

- **gm**: a `gm` subcommand or behaviour inside the product binary (`gm-core`
  and its host `gm`): install and uninstall, host registration, hand-over,
  version and stamp, process-group lifecycle, output and run-log handling.
- **gm-tool**: the one second C++ binary built from this tree. It holds what
  cannot live in the product: the check runner and the checks, the phase B
  gate, the commit gate, shipping, measurement, and the waste ranking.
- **leaf (native)**: a verb that today runs as a JavaScript leaf in the install;
  it becomes C++ inside `gm-core`.
- **external**: outside gm's build and install, and not gm's to replace (vendored
  third-party source, or a file that belongs to another product).
- **drop**: nothing reads it any more.

## Install and runtime (product)

| File | What it does now | Destination |
|---|---|---|
| `scripts/install.sh` | Installs the binaries under `~/.gmnew`, swaps `current`, keeps the previous build, runs `gm install` to register the MCP server. | gm: `gm install` (item 2b) |
| `scripts/install.ps1` | Windows install with the same steps. | gm: `gm install` on Windows (item 2b) |
| `scripts/gm.sh` | Launcher that runs the installed `gm`. | gm: the installed binary is the launcher; drop the shim |
| `scripts/gm.ps1` | Windows launcher. | gm: drop with `gm.sh` |
| `setup.sh` | Checks Node, runs the commit gate, prefetches, prints the install command. | gm: `gm install --check` (item 2b); drop Node checks |
| `scripts/measure-txiki-wasm.mjs` | Measures the txiki WASM build. | gm-tool: measurement (item 2e) |
| `txiki/build-site.mjs`, `txiki/site.mjs`, `txiki/site.html` | Builds a txiki demo page. | drop (not on any path a run takes) |
| `txiki/fs.mjs`, `txiki/host.mjs`, `txiki/node.mjs`, `txiki/project.mjs`, `txiki/verbs.mjs` | Node-side helpers for the txiki runtime. | drop after leaf moves; the embedded engine is C++ |
| `research/dep-recall/*.cjs` (7 files) | One-off dependency-recall experiments. | external: research, not product; keep out of the install |

## Leaves (JavaScript run in gm-core's embedded engine)

| File | What it does now | Destination |
|---|---|---|
| the code-ast leaf (formerly `native/leaves/code-ast.mjs`) | `callers` and `impact` over JavaScript and TypeScript. | done: native/components/verbs/code_ast.cpp on the vendored tree-sitter (native/third_party/tree-sitter, MIT, with its grammar licences), checked by gm-tool check-code-ast; the .mjs is removed (item 1 of round e6b5). Decision: tree-sitter for both grammars; no other native parser was needed. The gate skips third_party/ and vendor/ for the ASCII and comment rules (as it already did for the script rule), because upstream licence text and comments are not ours to rewrite. TypeScript is now parsed, not line-scanned; the line scan remains for a file that does not parse cleanly. Sites sort by byte order, where the leaf used localeCompare; the two have not been compared on this repository. |
| `native/leaves/fetch.mjs` | HTTP(S) and data URL fetch, 16 MiB cap. | done: native/components/verbs/fetch.cpp, checked by gm-tool check-fetch; the .mjs is removed (item 2d) |
| the git leaf | Git state reads for the run. | done: native/components/verbs/git.cpp (14 verbs), checked by gm-tool check-git; the .mjs is removed (item 2d) |
| the review leaf | Review of diffs for the run. | done: native/components/verbs/review.cpp (review_packet, review_record, review_join), checked by gm-tool check-review; the .mjs is removed (item 2d) |
| `native/leaves/rows.mjs` | Row-table reads and writes. | done: native/components/verbs/rows.cpp, checked by gm-tool check-rows; the .mjs is removed (item 2d, first leaf) |
| the wiki leaf (formerly native/leaves) | Wiki read and write. | done: native/components/verbs/wiki.cpp (wiki_search, wiki_write, wiki_lint), checked by gm-tool check-wiki; the .mjs is removed (item 2d) |
| `native/leaves/vendor/acorn.mjs` | Vendored JavaScript parser. | done: removed with code-ast; the gate was already native and has no acorn reference |
| install `leaves/*.mjs` and `leaves/vendor/acorn.mjs` | Copies of the six leaves and acorn. | done once the next install runs: the source directory `native/leaves/` no longer exists; the install check that follows the next install is the witness |

## Gate, phase B, ship (second tool)

| File | What it does now | Destination |
|---|---|---|
| `tools/gate.mjs` | Commit gate: syntax, ASCII, docs path check, AGENTS size, staged comments. | done: gm-tool gate (item 2c); the syntax check goes with the JavaScript |
| `tools/phase-b.sh` | Clean-tree build, stamp check, check-build, parity contract, writes `phase-b.pass`. | done: gm-tool phase-b (item 2c); still runs check-build.mjs and parity-contract.mjs until 2e |
| `tools/ship.sh` | Runs the gate, refuses trailers, commits by path, `--push` needs a matching `phase-b.pass`. | done: gm-tool ship (item 2c) |
| `tools/package.mjs`, `tools/release-manifest.mjs`, `tools/prune-release-assets.mjs` | Release packaging and manifest. | gm-tool: release (item 2e) |
| `tools/prefetch.mjs` | Fetches the release assets for setup. | gm: install (item 2b) |
| `tools/vendor-txiki.mjs` | Vendors the txiki source. | gm-tool: vendoring (item 2e) |
| `tools/gm-continue-setup.mjs` | Sets up the gm-continue skill. | gm: install (item 2b) |
| `tools/spawn.mjs` | Spawns a child session. | gm-tool (item 2e) |
| `tools/reconnect-check.mjs`, `tools/transcript-usage.mjs`, `tools/measure-*.mjs` (4), `tools/rank-run-waste.mjs` | Measurement and the waste ranking. | gm-tool: measurement (item 2e) |
| `tools/parity-contract.mjs`, `tools/mcp-conformance.mjs` | Parity contract and MCP conformance, run by phase B. | gm-tool: contract runner (item 2e) |

## Check runner and lifecycle

| File | What it does now | Destination |
|---|---|---|
| `tools/check-build.mjs` | Runs the checks in a pool and rescues pool failures. | gm-tool: check runner (item 2a) |
| `tools/lib/group.mjs` | Process groups for every spawn, exit sweep. | gm: process-group lifecycle (item 2a, in gm-tool first, then into gm as a shared library) |
| `tools/lib/gm-stdio.mjs`, `tools/lib/no-playwriter.mjs` | Shared stdio and playwriter-off helpers. | gm-tool (item 2e) |
| `tools/browser-stubs.mjs`, `tools/check-txiki-wasi-browser.js`, `tools/check-txiki-wasi-browser.html`, `tools/check-txiki-wasi-chromium.mjs`, `tools/check-txiki-wasi.mjs` | Browser and WASI runtime checks. | gm-tool (item 2e) |
| `tools/witness-*.mjs` (4): `witness-ci-replay-step`, `witness-next-context-replay`, `witness-redaction`, `witness-windows-cmd` | Witnesses: replay, redaction, Windows command quoting. | gm-tool (item 2e) |

## Checks (second tool, one group at a time, item 2e)

Each check is proven to fail on the fault it caught before its script is deleted.

| Group | Files |
|---|---|
| read and write | `check-read-after-write.mjs` (untracked; first native check, item 2a), `check-read-parity.mjs` |
| install and build | `check-build-handover.mjs`, `check-install-switch.mjs`, `check-install-follows` (native, gm-tool), `check-installed-build.mjs`, `check-startup-attempts.mjs`, `check-cli-flags.mjs`, `check-owner-identity.mjs` |
| next_context and feed | `check-context-feed.mjs`, `check-feed-reference.mjs`, `check-repeated-checks.mjs`, `check-cut-marker.mjs` |
| run_code | `check-run-code-budget.mjs`, `check-run-code-lifetime.mjs`, `check-run-code-progress.mjs`, `check-run-code-require.mjs`, `check-early-run-code.mjs`, `check-embedded-runtime.mjs`, `check-clock-mutations.mjs` |
| jobs and shell | `check-job-bounds.mjs`, `check-job-progress.mjs`, `check-job-reply-git-state.mjs`, `check-job-status-cancel.mjs`, `check-shell-stdin.mjs`, `check-restart-jobs.mjs`, `check-restart-body-orphan.mjs`, `check-inflight.mjs`, `check-child-task.mjs`, `check-task-set.mjs`, `check-foreground-hold.mjs`, `check-turn-economy.mjs`, `check-caller.mjs` |
| cancel and relay | `check-cancel-record.mjs`, `check-cancel-wait.mjs`, `check-relay-exit.mjs`, `check-relay-reexec.mjs`, `check-push-timing.mjs`, `check-stop-fetch.mjs` |
| skills and resources | `check-skill-serve.mjs`, `check-no-resource-client.mjs`, `check-restart-skill-read.mjs`, `check-resources-subscribe.mjs`, `check-protocol-versions.mjs`, `check-decision-parity.mjs`, `check-documented-gaps.mjs` |
| browser | `check-browser-project.mjs`, `check-browser-scope.mjs`, `check-background-visibility.mjs`, `check-tab-identity.mjs`, `check-console.mjs` |
| grep and output | `check-grep-paging.mjs`, `check-grep-state-scope.mjs` |
| hygiene (text and layout) | `check-lost-wording.mjs`, `check-node-fs-import.mjs`, `check-project-page.mjs`, `check-prd-receipt.mjs`, `check-prd-refuted-reopen.mjs`, `check-worker-growth.mjs` |

Each file above is a check the gate runs. `check-node-fs-import.mjs` checks for a
Node import in the tree and is removed with the rest once the group is native.

## Install directory after the move

Target: only `gm`, `gm-core`, `gm-tool` (binaries), skill text, and `defaults/`
data. The `leaves/` directory and `acorn.mjs` are removed once the leaves are
native. `.gmnew-update.json` stays as data.

## Ordering

1. Item 2a: `gm-tool` skeleton, check runner, process-group lifecycle, `check-read-after-write` native.
2. Item 2b: `gm install`, `gm uninstall`, registration, start check.
3. Item 2c: gate, phase B, ship in `gm-tool`; `tools/gate.mjs`, `tools/phase-b.sh`, `tools/ship.sh` removed.
4. Item 2d: leaves in order.
5. Item 2e: checks group by group.

## Dead-file groups (round e6b5, item 3)

| Group | Files | Reason |
|---|---|---|
| broken checks | tools/check-child-task.mjs, tools/check-grep-paging.mjs, tools/check-task-set.mjs | Each imports ./check-output-recovery.mjs, which is not in the tree, so none could run; nothing references them in code. |
| launchers | scripts/gm.sh, scripts/gm.ps1 | They ran tools/check-build.mjs through node and were not called by CI, ship or the build. The README paragraph now names the cmake commands. |
| txiki helpers | every file under txiki/ (seven .mjs modules and site.html) | A Node site builder for txiki with no code or CI reference outside its folder; the vendored runtime is native/third_party/txiki. |
| kept, not dead | the six research/dep-recall .cjs files, the tools measure-* scripts, and the tools check-* scripts not run by check-build | DESIGN.md cites the research files as the evidence behind decided results, and PENDING_VALIDATION cites the checks and measurements as the method of each recorded witness. Each moves to gm-tool or is deleted in item 4 with its group. |

## Playwriter pin (round e6b5, items 7 and 2 of the later round)

- Pin: defaults/mcp.json runs pw at 24646cc through the direct node entry: {"command": "node", "args": ["${HOME}/.gmnew/current/pw/bin/playwriter-project"]}. The config loader expands ${HOME} (native/components/mcpclient/config.cpp).
- Tool cache: defaults/mcp-tools/playwriter.json is lib/mcp-tools.json at 24646cc (execute and reset), ASCII-escaped with the same parsed content. The pin serves no browsers tool.
- playwriter_browsers is optional. BrowserScope lists it only when the launcher serves it; the browsers verb and browser_close_machine fail with a named reason when it does not (native/components/host/browser_scope.cpp). check-lazy-browser requires only playwriter_execute in the listing and asserts that the first browser call is the one that starts the launcher.
- Install step (built this round): gm install runs install_playwriter after the version switch (native/components/host/install.cpp). It clones AnEntrypoint/pw into current/pw, checks out 24646cc, runs npm ci there, and writes current/pw/gm-pin. A second install skips it when the pin and bin/playwriter-project are already there. The sandbox checks (check-lazy-browser, check-browser-scope) install into their own HOME, so the entry resolves under that install tree.
- Clean install witness (empty HOME, 2026-11-11): gm install --local build/release --source . took 7.04 s in total; the playwriter step took 6.94 s; its longest part was the clone at 5.35 s, then the checkout and npm ci.
- Browser calls to a tool the pinned cache does not list go through VerbTable::call_sibling, routed to the client that serves the listed sibling (playwriter_execute). That is how browser_close_machine reaches the launcher's browsers tool at 24646cc.

## Checks moved to gm-tool (round e6b5, item 5; continued in the teardown round)

| Node check (phase B, check-build) | native check | wall (ok run) | state |
|---|---|---|---|
| check-install-follows.mjs | check-install-follows | 4.5 s | moved; .mjs deleted |
| check-cli-flags.mjs | check-cli-flags | 0.08 s | moved; .mjs deleted |
| check-lazy-browser (native) | check-lazy-browser | 1.0 s | revised for the optional browsers verb |
| (new) | check-skill-reload | 5.2 s | refusal witness, item 4 |
| (new) | check-code-ast | under 1 s | item 1 |
| (new) | check-quickjs-baseline | under 1 s | item 2, measurement |
| check-browser-scope.mjs | check-browser-scope | 7.3 s | moved; .mjs deleted; survivors counted by tree and PID |
| check-worker-growth.mjs | check-worker-growth | 4.7 s | moved; .mjs deleted; 2048 KB limit over 400 calls |
| check-feed-reference.mjs | check-feed-reference | 0.37 s | moved; .mjs deleted |
| check-lazy-browser (native) | check-lazy-browser | 7.5 s | teardown by tree, PID survivor count, pin marker assert |

Still on Node at the start of this round (the next section records what moved after it):  the other 27 check-*.mjs and witness-*.mjs in the NATIVE list, the conformance run, and tools/parity-contract.mjs. Node is not removed from phase B: ship.cpp and check-build still need it for those. Node stays in phase B and check-build until each has a native replacement; the group-by-group list continues in the next round.

## Phase B timing (round e6b5, install step, dded62a)

- Phase B passed at dded62a in 3 min 54 s wall (exit 0).
- Longest step: check-skill-reload, 106.3 s wall inside Phase B (5.2 s alone). Next: check-install-follows 45.5 s; cli-flags 0.11 s.
- Install step: 6.9 s of the clean install (clone 5.35 s longest).

## Browser teardown and pin marker (round e6b5, items 1 and 3)

- Teardown: check-lazy-browser and check-browser-scope take the process tree (Session descendants, the PIDs the reply names, and processes whose command line names the sandbox HOME) before session.stop(), kill it, wait 200 ms, and fail with the count and PIDs of any survivor. Witness on check-browser-scope: with kill disabled it failed with "3 process(es) started by this check are still alive"; with a 1500 ms watchdog it failed on the browser open only, with zero survivors. Restored, both pass in about 7 s.
- Pin marker: gm reads the pin only in install_playwriter (native/components/host/install.cpp), to skip the clone when current/pw/gm-pin already says 24646cc. The launcher runs from the direct node entry in defaults/mcp.json, so no runtime path reads the marker. The marker is at current/pw/gm-pin, which is versions/<stamp>/pw/gm-pin; /config/.gmnew/current/gm-pin was never the right path. check-lazy-browser asserts the marker reads 24646cc and that ${HOME}/.gmnew/current/pw/bin/playwriter-project exists in the sandbox. Witness: with the expected pin changed to 00000000 it fails and prints the marker it read.

## Remaining Node checks ported (round e6b5, items 1 to 3)

Each check ran alone against build/release (build 57fd18494d81-dev, check on the built gm) and passed. Wall time is the check's own measure.

| Node check | native check | wall |
|---|---|---|
| check-run-code-budget.mjs | check-run-code-budget | 1.12 s |
| check-turn-economy.mjs | check-turn-economy | 0.94 s |
| check-restart-jobs.mjs | check-restart-jobs | 8.44 s |
| check-run-code-progress.mjs | check-run-code-progress | 0.46 s |
| check-read-parity.mjs | check-read-parity | 0.25 s |
| check-protocol-versions.mjs | check-protocol-versions | 0.44 s |
| check-relay-reexec.mjs | check-relay-reexec | skipped (dev stamp) |
| witness-next-context-replay.mjs | check-witness-next-context-replay | 0.07 s |
| check-build-handover.mjs | check-build-handover | 15.57 s |
| check-console.mjs | check-console | 0.13 s |
| mcp-conformance.mjs | mcp-conformance | 1.17 s (86 of 86 in 24 scenarios) |
| parity-contract.mjs (19 of 25 rows) | parity-contract | 23.40 s (18 witness groups over 20 witnesses) |

- Mutant witnesses: `tools/check-clock-mutations.mjs build/release` reinstates the 60 s job lifetime and the 30 s job wait cap. The native check-run-code-budget and check-turn-economy both fail on their mutant, and the sources are restored (84.25 s wall).
- Not ported: the `--real-clock` run of check-turn-economy (the native checks use the 1/60 scale only). parity-contract W19 and W20 test check-build's `--only` mode and name check-repeated-checks.mjs, which is deleted, so both fail until they are rewritten; W21 and W22 wrap the native check-install-switch and check-skill-serve; W25 wraps check-build-handover.
- Still Node, so Node stays in phase B: tools/check-build.mjs (the driver: pool, cache, the exclusive relay check, and the clock mutations under --mutations), tools/check-clock-mutations.mjs, and tools/parity-contract.mjs (W19 and W20). Phase B also still calls `node tools/check-build.mjs` and `node tools/parity-contract.mjs` from native/components/tool/ship.cpp.
- check-skill-reload, cause: the check waited for a restart with next_context waitMs 30000. The worker returns that wait only when an event is pending or the wait ends, so with no restart pending the check sat out the full 30 s, several times per run. It now polls next_context with waitMs 250 (await_restart, 30 s cap). Measured: 84 s to 17.6 s in the native run; 82.7 s inside Phase B before the change.
- gm-pin: the playwriter pin marker is current/pw/gm-pin. Only install_playwriter reads it (native/components/host/install.cpp, the pin_file in current/pw); lazy_browser asserts that path. A file named gm-pin directly under current (current/gm-pin) is not a path anything reads.
