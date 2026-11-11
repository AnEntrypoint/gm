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
| install and build | `check-build-handover.mjs`, `check-install-switch.mjs`, `check-install-follows.mjs`, `check-installed-build.mjs`, `check-startup-attempts.mjs`, `check-cli-flags.mjs`, `check-owner-identity.mjs` |
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
