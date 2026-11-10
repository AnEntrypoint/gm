#include "txiki_shim.h"

#include "private.h"

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

JSValue gm_txiki_refresh_loop_time(JSContext *ctx, JSValueConst this_value, int argc, JSValueConst *argv) {
    (void) this_value;
    (void) argc;
    (void) argv;
    uv_update_time(&TJS_GetRuntime(ctx)->loop);
    return JS_UNDEFINED;
}

JSModuleDef *gm_txiki_load_builtin(JSContext *ctx, const char *module_name) {
    return tjs_module_loader(ctx, module_name, TJS_GetRuntime(ctx), JS_UNDEFINED);
}
