#include "txiki_shim.h"

#include "private.h"

#ifdef _WIN32
#include <windows.h>
#else
#include <poll.h>
#endif

int gm_txiki_exit_code(void) {
    return tjs_exit_code();
}

TJSRuntime *gm_txiki_new(void) {
    TJSRunOptions options;
    TJS_DefaultOptions(&options);
    TJSRuntime *runtime = TJS_NewRuntimeOptions(&options);
    if (runtime != NULL) {
        uv_unref((uv_handle_t *) &runtime->stop);
    }
    return runtime;
}

void gm_txiki_free(TJSRuntime *runtime) {
    TJS_FreeRuntime(runtime);
}

JSContext *gm_txiki_context(TJSRuntime *runtime) {
    return TJS_GetJSContext(runtime);
}

int gm_txiki_loop_alive(TJSRuntime *runtime) {
    return uv_loop_alive(&runtime->loop);
}

void gm_txiki_loop_turn(TJSRuntime *runtime) {
    uv_run(&runtime->loop, UV_RUN_NOWAIT);
}

void gm_txiki_loop_wait(TJSRuntime *runtime, int limit_ms) {
    uv_loop_t *loop = &runtime->loop;
    int timeout = uv_backend_timeout(loop);
    if (timeout < 0 || timeout > limit_ms) timeout = limit_ms;
#ifdef _WIN32
    Sleep((DWORD) timeout);
#else
    struct pollfd watch = {uv_backend_fd(loop), POLLIN, 0};
    poll(&watch, 1, timeout);
#endif
}

JSValue gm_txiki_refresh_loop_time(JSContext *ctx, JSValueConst this_value, int argc, JSValueConst *argv) {
    (void) this_value;
    (void) argc;
    (void) argv;
    uv_update_time(&TJS_GetRuntime(ctx)->loop);
    return JS_UNDEFINED;
}

JSValue gm_txiki_core(JSContext *ctx) {
    return JS_DupValue(ctx, TJS_GetRuntime(ctx)->builtins.internal_core);
}

JSModuleDef *gm_txiki_load_builtin(JSContext *ctx, const char *module_name) {
    return tjs_module_loader(ctx, module_name, TJS_GetRuntime(ctx), JS_UNDEFINED);
}
