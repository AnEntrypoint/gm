# edgejs spike for gm (stage 0 of specs/edgejs-swap.md)

Plan: /workspace/hyperagent/specs/edgejs-swap.md, stage 0, gm part. txiki stays in place; nothing is removed at this stage.

## What was read, and how

Read through the GitHub API and raw files at edgejs commit 57af3635598b30ab50fa163328c1ece5d373dc91 (main on 2026-11-21, VERSION.txt 0.2.5), nothing cloned into the shared checkout: README.md, ARCHITECTURE.md, cmake/EdgeOptions.cmake, cmake/EdgeNapiProvider.cmake, CMakeLists.txt, Makefile, src/edge_napi_embedder_hooks.h, .gitmodules, the include/ and deps/ listings.

Findings from the files:
- Engine options: EDGE_NAPI_PROVIDER is bundled-v8 (the default for make build; needs a prebuilt V8 and LLD 20 or newer on Linux), quickjs (napi/quickjs, quickjs at wasmerio/quickjs, make build-edge-quickjs-cli) or imports (N-API imported from a host engine, the WASIX package). This host has gcc 15.2 and no clang or lld, so the V8 route cannot link here; quickjs is the smallest native option and the one this spike builds.
- Other options that matter for gm: EDGE_EMBED_BUILTIN_SOURCES and EDGE_EMBED_ICU_DATA (both ON for native builds), EDGE_SHARED_OPENSSL (OFF: vendored OpenSSL), EDGE_QUICKJS_WEBASSEMBLY (ON by default, downloads the Wasmer C API at configure time; the spike turns it OFF so the build needs no download beyond the pin), EDGE_BUILD_CLI (ON).
- Libraries: CMakeLists.txt declares edge_node_api, edge_environment_core, edge_runtime and edge_cli as STATIC libraries and edge_runtime_core as an OBJECT library; ARCHITECTURE.md names edge_runtime "the stable aggregate target for tests and embedders". The edge executable is linked with ENABLE_EXPORTS, so a loaded .node addon can resolve napi_* from it.
- Embedding surface: the public headers are include/node_api.h and include/node_api_types.h. src/edge_napi_embedder_hooks.h declares only EdgeGetTotalMemory() and EdgeInitializeNapiEnvCreateOptions(unofficial_napi_env_create_options*). New bindings are N-API initialisers (napi_value InitFoo(napi_env)) listed in src/binding_registry/binding_list.h. No embedding guide, module-resolution hook or hot-reload hook is documented.
- Submodules needed for a native quickjs build: napi (wasmerio/napi at f33cd8afc9f2628d5379d8fbd84074794d5827bd) and, inside it, quickjs/deps/quickjs (wasmerio/quickjs at fcf1604905689e8f878ba300f2ede419a94df38e). test, wasmer-examples, ssl-certs, deps/libuv-wasix and deps/openssl-wasix are not referenced by the native CMake files. libuv, OpenSSL, ICU (icu-small), llhttp, nghttp2, c-ares, zlib, zstd, brotli, simdjson, simdutf, ada and undici are vendored under deps/.

## The pin and the fetch step

- tools/edgejs/pins.json holds the three commits and, for each, the sha256 of git archive --format=tar of that commit (stable for a given tree). tools/edgejs/spike.sh fetch makes a depth-1 git fetch of each pinned commit into the scratch store, checks the digest, and unpacks the three trees into one source tree.
- Why not the codeload tarballs: from this host codeload sent the edgejs archive at about 800 bytes a second (73 kB after 6 minutes); a depth-1 git fetch took 340 s for edgejs (77 MB), 7 s for napi and 10 s for quickjs.
- Sizes: edgejs 30,038 files, napi 413, quickjs 231; the unpacked source tree is 576 MB.
- Witness: spike.sh fetch from the pins succeeds (4 s with the store filled). Red: one changed digest character in pins.json makes fetch stop with "napi tree at f33cd8af... has sha256 e7a1c7a3991a7ffa..., the pin says e7a1c7a3991a7ffb..." and exit 1.

## Questions this spike answers

| question | how it is measured | answer |
|---|---|---|
| Does edgejs build natively here with the smallest engine (quickjs)? | spike.sh configure and build as gm-edgejs tickets (logs /workspace/tmp/gm/edgejs/part1.log to part3.log) | Yes. gcc 15.2 and cmake 4.2.3 on this 12-core host built it with EDGE_NAPI_PROVIDER=quickjs, Release, EDGE_EMBED_BUILTIN_SOURCES and EDGE_EMBED_ICU_DATA ON, vendored OpenSSL, -j3, in ONE ticketed part: the whole build fitted well inside the 30-minute part limit, so parts 2 and 3 found "no work to do" and only ran outputs, start-up and smoke. The V8 provider cannot link here: it needs clang or lld 20 and a prebuilt V8, and this host has neither |
| Build time | sum of the measured parts (tools/edgejs/measure.py wall time) | 19.6 s configure plus 301.4 s build (1,973 ninja steps), 5 min 21 s in all, with the three-job limit the ticket allows. A second build from the same pin after a host reboot (fetch, configure 17.7 s, build 263.5 s, 1,293.8 MiB peak tree, 517.9 MiB largest process) produced a binary of the identical size, 68,942,024 bytes |
| Peak memory | measure.py: peak summed resident memory of the build process tree, and the largest single process | 1,293.9 MiB summed over the tree, 517.3 MiB in the largest single process (configure 57.9 MiB): the OpenSSL and ICU compiles the spec worried about fit in about 1.3 GiB, well under the gate memory rule |
| Output size | spike.sh outputs: size of edge, the static libraries, the build tree | build/edge 68,942,024 bytes (65,949,712 stripped), dynamically linked against libc, libm, libstdc++ and libgcc only; no edgeenv target is built by the edge target; all static libraries together 88.2 MB, build tree 460 MB; source tree 576 MB. The published prebuilts are larger (QuickJS 155.7 MB, V8 157.8 MB) |
| Does a static library come out for an embedder? | the .a files the build leaves (edge_runtime and its parts) | Yes: libedge_runtime.a 17,232,042 bytes (the stable aggregate target ARCHITECTURE.md names), libedge_cli.a 652,078, plus the dependency libraries it needs: libedge_vendored_openssl.a 15.1 MB, libedge_icu_embedded_data.a 33.1 MB, libedge_icu_i18n.a 9.0 MB, libedge_icu_common.a 4.3 MB, libqjs.a 1.7 MB, libnapi_quickjs.a 0.9 MB, libedge_node_api.a, libedge_environment_core.a, libuv, c-ares, zlib, zstd, brotli, nghttp2, simdjson, simdutf and ada. An embedder links libedge_runtime.a and these; the 33 MB ICU data library is what EDGE_EMBED_ICU_DATA=OFF drops |
| Engine options | the files above, and the published nightlies | bundled-v8, quickjs, imports. Published Linux x64 nightlies exist for two: edge-linux-amd64.zip (V8, release 0.2.5-v8-nightly, 51,942,193 bytes) and edge-quickjs-linux-amd64.zip (QuickJS, 0.2.5-nightly, 54,439,138 bytes) in wasmerio/edgejs-nightlies; the installer at edgejs.org/install fetches the V8 one |
| Start-up time and resident memory | spike.sh startup with EDGEJS_BIN set to the prebuilt edge: edge -e 0 three times | V8 prebuilt (v24.13.2-pre, 157,751,848-byte bin/edge, dynamically linked against libc, libm, libstdc++ and libgcc only): 0.213, 0.210 and 0.215 s wall; 57.8 to 60.9 MiB peak resident (ru_maxrss). QuickJS prebuilt (edge-quickjs-linux-amd64.zip, 54,439,138 bytes, sha256 39f150b3...e312cb; bin/edge 155,727,104 bytes, same libc, libm, libstdc++, libgcc dependencies): 0.209, 0.208 and 0.210 s wall; 42.5 to 47.9 MiB peak resident, about 15 MiB less than the V8 binary. Its process.versions still lists a v8 entry (the version table is static) and the binary is as large as the V8 one, so the 155 MB is mostly the embedded Node builtins and ICU data, not the engine |
| Host function through N-API | spike.sh smoke: a C addon (tools/edgejs/smoke/host.c, built with gcc against napi/include) exporting sum, loaded with createRequire from a module on disk | V8 prebuilt: works, sum(40, 2) returned 42; edge exports napi_* to the addon. QuickJS prebuilt: works, sum(40, 2) returned 42 |
| node:fs, node:net, node:child_process, node:sqlite and fetch | the same smoke module: a temp file written and read back, a TCP echo on 127.0.0.1, spawnSync of /bin/sh, an in-memory DatabaseSync, fetch from a local node:http server | V8 prebuilt: fs ok, net ok (echo), child_process ok (status 3, stdout child), fetch ok (200, body fetched /probe); node:sqlite fails: lib/sqlite.js is internalBinding('sqlite') and src/binding_registry/binding_list.h registers no sqlite binding, so the module is empty and DatabaseSync is not a constructor ("Cannot convert undefined or null to object"). The QuickJS prebuilt gives the identical result set (same sqlite failure); the whole smoke run is 0.422 s wall and 76.1 MiB peak resident on V8, 0.210 s and 75.7 MiB on QuickJS |
| Is the build reproducible from the pin? | fetch from pins.json and build from that tree only | Yes: the three trees came from spike.sh fetch (digest-checked) and the build used only that tree; part 2 and 3 repeated the build command and ninja reported no work |

Not answered by the gm spike: the fx permission-gate question (fx's part), the browser package (thebird's part) and the parity count (freddie's part).

## What the binary answers and what only the build answers

- Answered by the published V8 binary (above): start-up time, resident memory, the N-API host function, fs, net, child_process, fetch, and that sqlite is missing in this tree.
- Answered only by the build: whether a static library comes out for an embedder, build time, peak build memory, and the output size per engine. The prebuilt zips carry bin/edge, bin/edgeenv and a node shim only, no library.
- For fx and freddie now: sqlite needs a host module or a vendored sqlite binding; the embedding entry points in src/edge_runtime.h (EdgeRunScriptFile, EdgeRunScriptSourceWithLoop on a napi_env) and the N-API addon route both exist; Node's permission binding is in the registry (internalBinding permission), which is one of the gate options fx is testing.

## Built-from-pin binary (QuickJS), measured

- spike.sh startup on build/edge: 0.208, 0.208 and 0.207 s wall; largest-process resident memory 31.1 to 36.2 MiB at start-up (38.8 MiB for a console.log run). That is the same 0.21 s as the prebuilt binaries and lower resident memory than the prebuilt QuickJS (42.5 to 47.9 MiB).
- spike.sh smoke on build/edge: the same result set as both prebuilts (host function 42, fs, net, child_process, fetch ok; sqlite fails because no sqlite binding is registered), 0.207 s wall, 65.3 MiB largest-process resident.

## For specs/edgejs-swap.md, facts to update

- Build: natively built with the QuickJS provider from three pinned commits in 5 min 21 s, 1.3 GiB peak tree memory, 68.9 MB binary, no wasixcc, clang or lld needed; V8 needs clang/lld 20 and a prebuilt V8.
- Static library: libedge_runtime.a (17.2 MB) plus its dependency libraries (88.2 MB of .a in all, 33 MB of it ICU data); edge_runtime is documented as the embedder target and the headers for N-API are in napi/include (js_native_api.h, node_api.h, unofficial_napi.h), which come from the wasmerio/napi submodule, not from the edgejs include directory.
- Published binaries exist: wasmerio/edgejs-nightlies, edge-linux-amd64.zip (V8, 0.2.5-v8-nightly) and edge-quickjs-linux-amd64.zip (0.2.5-nightly), both about 155 MB unpacked. Start-up 0.21 s and 42 to 61 MiB resident for all three binaries.
- sqlite: node:sqlite is not usable in this tree (internalBinding('sqlite') is not registered). fetch, node:net, node:fs, node:child_process and an N-API addon with a host function work.
- Unaffected claim still open: the fx permission-gate question and whether safe mode under Wasmer is needed.
