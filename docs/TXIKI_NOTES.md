# txiki notes and vendoring

Moved from AGENTS.md on 2026-11-22 so that AGENTS.md stays under the gate limit. The text below is unchanged. AGENTS.md keeps the rules and a pointer to this file.

## Vendored txiki notes (moved from source comments)

These notes were in comments in native/third_party/txiki/txiki/src and were moved here when the comments were swept (invariant 2). Each was checked against the code when it was moved.

### mod_channel.c

- The file is the in-process transport for MessagePort, MessageChannel and BroadcastChannel: it provides cross-thread wakeups and structured-clone (de)serialization, while the Web API shape is implemented in JS rather than here.
- Messages are serialized with JS_WriteObject2, whose buffer is js_malloc'd in the sender runtime, so channel_msg_build copies the bytes into tjs__malloc storage and frees the original because a message may be freed on the receiving thread.
- Payloads are deserialized with JS_ReadObject2 only in the owner's context (port_dispatch_one and broadcast_dispatch_one).
- Each SharedArrayBuffer is tjs__sab_dup'd when a message is produced and released by channel_msg_free for every message, delivered or dropped, while the read path takes its own dups for the reconstructed buffers.
- channel_msg_dup copies no transferred ports, because only one endpoint may receive a given port.
- port_post drops a message that transfers a port whose receive mailbox is the destination itself, because that mailbox would have no remaining owner to drain it and the message would leak.
- Cross-thread access is limited to the mailbox message list and receiving_port, which are only touched under the mailbox lock, while port state and recv_mb are changed only on the owning loop thread.
- tjs_port_postmessage refuses the whole transfer when any buffer is immutable, before any port moves, because JS_DetachArrayBuffer ignores the immutable flag and would free memory that a pending native write still reads.
- tjs_port_postmessage reads the port and buffer values into a snapshot before the immutability check and the detach, and runs no JS between them, so a getter cannot pin a buffer that is about to be detached.
- tjs_port_postmessage allocates the transfer list before moving any port, so an allocation failure cannot strand a half-transferred port.
- port_build_ports on allocation failure leaves the ports on the message so channel_msg_free reclaims them, and delivers with an empty port list.
- port_dispatch_one delivers a bare messageerror when the payload cannot be reconstructed, discarding the underlying exception because MessageEvent has no field for it.
- port_dispatch_one is only reached for started ports, since an unstarted port has no receiving_port and its async is only signalled once tjs_port_start has set one.
- tjs_port_start wakes the async once after becoming the owner so that messages buffered before start() are flushed, and an empty wake is harmless.
- tjs_port_finalizer always closes the async handle because it is created in the constructor, and the struct is freed in the close callback.
- tjs_new_port creates its async unreferenced so an unstarted port does not keep the loop alive, and its only failure paths occur before the mailbox refs are taken.
- tjs_new_port_from_ref takes its own refs before dropping the refs carried by the message, and destroys the channel if wrapping fails so it does not leak.
- tjs_channel_new throws out-of-memory itself because mailbox_new sets no JS exception.
- mailbox_close clears receiving_port and drains buffered messages under one lock hold, then frees them outside the lock because freeing a message can close other mailboxes.
- mailbox_destroy runs only at refcount zero, so it can drop buffered messages without taking the lock.
- port_ref_destroy closes the receive side so the former peer's sends are dropped.
- channel_msg_release_sabs is idempotent: it clears the SAB list and count after releasing them.
- tjs__channel_mailbox_pair gives each mailbox a reserved ref, and worker.c releases them with tjs__channel_mailbox_unref once both sides are wrapped.
- tjs__channel_port_unref leaves a worker-channel port started, so posts to a closed peer are dropped rather than thrown.
- tjs__channel_port_post_error is best-effort and swallows its own failures so that it never masks the original error.
- tjs__channel_port_close disentangles a worker-channel port so the loop can exit on terminate, and leaves the handle valid for the finalizer.
- broadcast_new leaves its async unreferenced so an open BroadcastChannel does not keep the loop alive, and buffered messages are still delivered while the loop runs for other reasons.
- broadcast_do_close takes broadcast_registry_lock itself, so callers must not hold it.
- tjs_broadcast_finalizer frees the struct with tjs__free because broadcast_async_close_cb can run after the runtime is torn down.
- tjs_broadcast_postmessage serializes once and enqueues an independent copy per target, skipping a target whose copy cannot be allocated so that no message is delivered without matching SAB dups.

### vm.c

vm.c:93 The 64-bit ref_count at the start of TJSSABHeader keeps buf 8-byte aligned, as 8-byte typed arrays require.
vm.c:175 tjs__js_post_worker_error (exposed to JS as postWorkerError) forwards the error through tjs__worker_post_error, which returns at once on the main thread.
vm.c:188 The draining_microtasks flag makes a nested drain return early, which prevents unbounded JS_ExecutePendingJob nesting when a microtask dispatches another event.
vm.c:389 dispatch_event_func is set to undefined at the start of TJS_FreeRuntime, so tjs__dispatch_event becomes a no-op during teardown.
vm.c:405 error_event_ctor is cleared at the start of TJS_FreeRuntime, so tjs__worker_handle_uncaught returns without dispatching once teardown has begun.
vm.c:411 The worker-scope error event is created cancelable, so a self.onerror handler that calls preventDefault() stops the error from being forwarded to the parent.
vm.c:455 uv__maybe_idle starts the idle handle while rejections are pending, so the loop runs another iteration and the check phase can dispatch unhandledrejection from inside a libuv callback.
vm.c:485 Rejections are recorded and only processed after microtasks drain, so a rejection handled synchronously (for example Promise.reject(x).catch(fn)) never fires an event.
vm.c:546 tjs__global_init runs through uv_once in TJS_NewRuntimeInternal, so it executes once per process and before any runtime touches mbedtls or lws.
vm.c:597 jobs.prepare runs uv__prepare_cb, which starts or stops the jobs.idle handle according to whether jobs or rejections are pending.
vm.c:601 jobs.idle is started only while jobs or rejections are pending, which stops uv_run from blocking on I/O at that point.
vm.c:605 jobs.check runs uv__check_cb, which executes pending jobs and then updates the idle handle.
vm.c:609 qrt->stop is a uv_async handle that TJS_Stop signals, which is safe from other threads.
vm.c:667 handle_pins holds the native-handle self-pins that TJS_FreeRuntime detaches and releases during teardown.
vm.c:682 The pin is detached and cleared before its reference is dropped, because that drop can finalize the wrapper synchronously and the finalizer asserts the pin is already released.
vm.c:698 After tjs__release_pins clears the pin, later releases only decrement the count, and unpinning an idle pin is a no-op because pin->obj is undefined.
vm.c:707 tjs__detach_handles runs each pin detach hook at teardown start and in every drain round, and the fswatch and process hooks begin closing their libuv handles so the close no longer depends on the GC.
vm.c:732 tjs__release_pins moves handle_pins onto a local list before releasing each entry, so a finalizer that touches handle_pins cannot disturb the traversal.
vm.c:749 tjs__lws_teardown is safe to run again, and tjs__reap_late_resources runs it on every drain round while qrt->lws.ctx is set.
vm.c:797 A worker runtime is freed on a different thread from the one that created it, so JS_UpdateStackTop re-anchors the QuickJS stack check before the drain runs JS.
vm.c:802 Handles are detached before anything else is dismantled, so no handle callback can run into a half-torn-down runtime.
vm.c:808 The rejection tracker and the dispatch and error-event builtins are cleared before the drain, so the C paths that use them become no-ops instead of running JS in a half-torn-down runtime.
vm.c:835 The keepalive handle is closed here, so ref and unref calls from a lws context recreated during the drain act on a closed handle, which libuv ignores.
vm.c:842 The lws context is destroyed before JS_FreeContext, so remaining WSI_DESTROY callbacks can still release GC references.
vm.c:846 The teardown drain runs at most 32 rounds and then stops microtasks, blocks in UV_RUN_ONCE while threadpool requests are in flight, and so makes teardown wait for running native work, which can hang if that work never finishes.
vm.c:917 qrt is freed only after JS_FreeRuntime, because finalizers run then and look up class ids through the runtime opaque.
vm.c:920 Requests left uncompleted by an abnormal exit can leave pins behind, so tjs__free_buf_pins runs after the engine is freed.
vm.c:949 The assert on lws.log_cx.refcount requires every lws object bound to the log context to have been finalized inside lws_context_destroy.
vm.c:962 The Windows invalid-parameter handler is a no-op, so CRT calls return an error instead of terminating the process.
vm.c:985 TJS_Initialize copies argv into tjs__argv because uv_setup_args only copies argv on Unix and not when its allocation fails, and runtimes created later read tjs__argv.
vm.c:1021 The Windows error mode flags suppress the WER crash dialog and the OS critical-error message box, so the CLI never blocks on GUI error dialogs.
vm.c:1074 In a worker, an uncaught error is reported to the parent and the pending exception is re-thrown so it still reaches stderr.
vm.c:1091 Rejections are deferred until microtasks drain (tjs__process_deferred_rejections) so a rejection caught synchronously never fires unhandledrejection.
vm.c:1112 If constructing the PromiseRejectionEvent throws (for example after user code overwrote a global it uses), the rejection is treated as unhandled and aborts.
vm.c:1145 In a worker, an aborting unhandled rejection also forwards its reason to the parent, because the unhandledrejection event was already dispatched at the worker global or could not be constructed.
vm.c:1183 An exception raised while dispatching beforeunload is left pending, so TJS_Run reports it and exits with an error.
vm.c:1203 The stop handle is unreferenced only in the main runtime, so a worker stays alive while the stop handle is referenced.
vm.c:1227 A fatal error leaves an exception pending, which skips beforeunload and is reported after the loop.
vm.c:1239 After beforeunload is prevented, the loop runs again only while jobs are pending or the loop is alive, otherwise uv_run would return at once and spin forever.
vm.c:1257 TJS_FreeRuntime closes stop before the drain can run JS that calls TJS_Stop, and libuv forbids sending to a closing handle, so TJS_Stop checks uv_is_closing first.
vm.c:1344 QuickJS JS_Eval needs the buffer to be NUL-terminated, so the terminator is written while the length passed to JS_Eval excludes it.
vm.c:1360 The native path is used as the module name, so import.meta and relative imports resolve as if the path were given directly.
vm.c:1381 The buffer is NUL-terminated for JS_Eval while the length passed excludes the terminator.

### mod_fs.c

The readFile worker fills a TBuf that tbuf_init(NULL, ...) leaves without a runtime, so it grows through the untracked tjs__realloc and the completion callback must copy it into a js_malloc buffer before TJS_NewUint8Array, because ArrayBuffer transfer reallocates through QuickJS malloc_state.

### mod_process.c

- tjs_process_detach begins closing the uv process handle when runtime teardown runs the TJSHandlePin detach hook (tjs__detach_handles in vm.c), so the handle closes without waiting for GC to finalize the wrapper.
- A pinned Process holds a JS reference to itself via tjs__handle_pin (which dups the object), so its finalizer can only run after the pin is released on exit or teardown, which the CHECK asserts.
- uv_spawn leaves the handle on the loop queue (uv__handle_init) even when it fails, so the failure path must uv_close the handle and let uv__close_cb free it instead of freeing it directly.

### mod_sys.c
- tjs_buffer_is_pinned: a buffer pinned by an in-flight native request is marked immutable by tjs_buf_ref_get in utils.c, and JS_DetachArrayBuffer ignores that flag and would free memory the request still reads, so tjs_detachArrayBuffer must refuse such buffers.

### private.h
- TJSHandlePin: `obj` is a GC-invisible duplicate of the handle wrapper held only while a libuv operation is in flight, and `detach` runs at the start of teardown (tjs__detach_handles in vm.c) so that lws-backed handles only clear their JS callbacks (lws closes them later in lws_context_destroy) while libuv-backed handles begin closing via maybe_close, without touching the pin itself.
- TJSReqPin: a counted self-pin held while libuv write, shutdown and send requests are in flight, kept separate from the handle read, listen and connect pin.
- lws log context (TJSRuntime.lws.log_cx): each runtime owns its own lws_log_cx_t because lws refcounts its log context without a lock (that claim is lws behaviour and is not checked in this tree), and TJS_FreeRuntime asserts its refcount is zero (vm.c), so it must outlive every lws context, vhost and wsi of that runtime.
- handle_pins: the list of TJSHandlePin self-pins that tjs__release_pins drops at teardown so the final GC can collect the wrappers and close their handles.
- buf_pins: a hash table keyed by ArrayBuffer pointer whose entries exist only while a TJSBufferRef holds a count (utils.c).
- tjs__class_register: returns 0 without re-registering when the class is already registered in this runtime, and returns -1 with a pending exception when registration fails (vm.c).
- tjs__handle_pin and tjs__handle_unpin: pinning duplicates obj and links the pin into the runtime handle_pins list only while the pin is idle, and unpinning an idle pin is a no-op (vm.c).
- tjs__req_pin_acquire: the first in-flight request pins obj, and an undefined obj is only counted without pinning (vm.c).
- tjs__req_pin_release: the last release unpins, which can finalize the wrapper synchronously, so it must be the last action of a request callback, and after tjs__release_pins releases only decrement the count (vm.c).
- tjs__detach_handles: runs each registered pin detach hook at the start of teardown and again in the late-resource reap, so no handle callback runs into a half-torn-down runtime (vm.c).
- Worker mailbox pair (tjs__channel_mailbox_pair): the parent creates two mailboxes, each with one reserved ref, wraps one side per loop as a port, and releases both reserved refs with tjs__channel_mailbox_unref once the ports exist (mod_channel.c, worker.c).
- tjs__worker_post_error: a no-op unless the runtime is a worker with a live internal_message_pipe, and it forwards an uncaught worker error to the parent (worker.c).
- tjs__worker_handle_uncaught: a no-op unless the runtime is a worker with an error_event_ctor, it dispatches a cancelable ErrorEvent on the worker global scope and forwards the error to the parent only when that event was not canceled (vm.c).
- tjs__file_url_to_path: returns a js_malloc-ed path, or NULL with a pending TypeError when the URL has an unsupported host or an empty path (modules.c).

## Vendoring txiki, quickjs-ng and libuv (shared by gm, thebird and fx)

- One pin file, one script: tools/txiki/pins.json holds the archives with their sha256, the file selections, the patches and the browser-port pins; tools/txiki/vendor.mjs does the work. A consumer vendors into its own tree with node tools/txiki/vendor.mjs --target <dir>; --browser --glue <c file> adds the browser port and its generated stubs (gm and thebird); --verify rechecks a tree against its MANIFEST.sha256 without network.
- The script downloads each archive, refuses a sha256 that differs from the pin, copies the selection with non-ASCII characters in comments written as ASCII, applies the patches in order after checking each patch's sha256, and writes VERSION.txt and MANIFEST.sha256 (one sha256 per vendored file). Re-running it on the same pins reproduces the tree byte for byte; check-txiki-vendor checks that in the registry.
- tools/txiki/patches/txiki-gm.patch is every change gm made to six txiki sources (syncReadFile, setExitCode, evalInNewRealm, compileScript, extra spawn stdio, the readdir slot, and the sweep of the comments); tools/txiki/patches/quickjs-async-frame.patch gives the runtime one async frame that a promise reaction captures when it is registered and restores while it runs (JS_GetAsyncFrame, JS_SetAsyncFrame). A change to a vendored file is made as a patch in this directory with its sha256 in pins.json, never by editing the vendored file alone.
- gm's own additions to the core binding (tjs:internal/core) are one shared file, tools/txiki/extras/core_extras.cpp (no gm header; its sha256 is pinned in tools/txiki/pins.json as hostExtras, so editing it means updating the pin; node tools/txiki/vendor.mjs --extras <dir> hands it to fx and thebird), installed into every run_code runtime by native/components/quickjs/core_extras_host.cpp: spawnSync (blocking, through the one SpawnSync seam, proc::run here), zstdDecompress, brotliDecompress, vmCreateContext and vmRunInContext (a context whose globals sync with a sandbox object), and asyncFrame (the value that follows awaits and promise chains).
