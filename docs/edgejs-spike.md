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
| Does edgejs build natively here with the smallest engine (quickjs)? | spike.sh configure, then spike.sh build in ticketed parts under 30 minutes (queued: gm-edgejs tickets 1072948, 1073570, 1074264, results in /workspace/tmp/gm/edgejs/part1.log to part3.log) | pending the build; the prebuilt binaries answer the run-time questions without it |
| Build time | sum of the measured parts (tools/edgejs/measure.py wall time) | pending |
| Peak memory | measure.py: peak summed resident memory of the build process tree, and the largest single process | pending |
| Output size | spike.sh outputs: size of edge, the static libraries, the build tree | pending |
| Does a static library come out for an embedder? | the .a files the build leaves (edge_runtime and its parts) | pending |
| Engine options | the files above, and the published nightlies | bundled-v8, quickjs, imports. Published Linux x64 nightlies exist for two: edge-linux-amd64.zip (V8, release 0.2.5-v8-nightly, 51,942,193 bytes) and edge-quickjs-linux-amd64.zip (QuickJS, 0.2.5-nightly, 54,439,138 bytes) in wasmerio/edgejs-nightlies; the installer at edgejs.org/install fetches the V8 one |
| Start-up time and resident memory | spike.sh startup with EDGEJS_BIN set to the prebuilt edge: edge -e 0 three times | V8 prebuilt (v24.13.2-pre, 157,751,848-byte bin/edge, dynamically linked against libc, libm, libstdc++ and libgcc only): 0.213, 0.210 and 0.215 s wall; 57.8 to 60.9 MiB peak resident (ru_maxrss). QuickJS prebuilt: pending its download |
| Host function through N-API | spike.sh smoke: a C addon (tools/edgejs/smoke/host.c, built with gcc against napi/include) exporting sum, loaded with createRequire from a module on disk | V8 prebuilt: works, sum(40, 2) returned 42; edge exports napi_* to the addon. QuickJS prebuilt: pending |
| node:fs, node:net, node:child_process, node:sqlite and fetch | the same smoke module: a temp file written and read back, a TCP echo on 127.0.0.1, spawnSync of /bin/sh, an in-memory DatabaseSync, fetch from a local node:http server | V8 prebuilt: fs ok, net ok (echo), child_process ok (status 3, stdout child), fetch ok (200, body fetched /probe); node:sqlite fails: lib/sqlite.js is internalBinding('sqlite') and src/binding_registry/binding_list.h registers no sqlite binding, so the module is empty and DatabaseSync is not a constructor ("Cannot convert undefined or null to object"). The whole smoke run: 0.422 s wall, 76.1 MiB peak resident |
| Is the build reproducible from the pin? | fetch from pins.json and build from that tree only | fetch witnessed above; build pending |

Not answered by the gm spike: the fx permission-gate question (fx's part), the browser package (thebird's part) and the parity count (freddie's part).

## What the binary answers and what only the build answers

- Answered by the published V8 binary (above): start-up time, resident memory, the N-API host function, fs, net, child_process, fetch, and that sqlite is missing in this tree.
- Answered only by the build: whether a static library comes out for an embedder, build time, peak build memory, and the output size per engine. The prebuilt zips carry bin/edge, bin/edgeenv and a node shim only, no library.
- For fx and freddie now: sqlite needs a host module or a vendored sqlite binding; the embedding entry points in src/edge_runtime.h (EdgeRunScriptFile, EdgeRunScriptSourceWithLoop on a napi_env) and the N-API addon route both exist; Node's permission binding is in the registry (internalBinding permission), which is one of the gate options fx is testing.
