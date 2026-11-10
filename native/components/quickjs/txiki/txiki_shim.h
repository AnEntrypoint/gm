#ifndef GM_TXIKI_SHIM_H
#define GM_TXIKI_SHIM_H

#include <quickjs.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct TJSRuntime TJSRuntime;

TJSRuntime *gm_txiki_new(void);
void gm_txiki_free(TJSRuntime *runtime);
JSContext *gm_txiki_context(TJSRuntime *runtime);
int gm_txiki_loop_alive(TJSRuntime *runtime);
void gm_txiki_loop_turn(TJSRuntime *runtime);
JSModuleDef *gm_txiki_load_builtin(JSContext *ctx, const char *module_name);
JSValue gm_txiki_refresh_loop_time(JSContext *ctx, JSValueConst this_value, int argc, JSValueConst *argv);

#ifdef __cplusplus
}
#endif

#endif
