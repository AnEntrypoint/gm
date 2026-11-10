#include "private.h"

const uint8_t tjs__run_repl[1] = { 0 };
const uint32_t tjs__run_repl_size = 0;

const char *lws_get_library_version(void) {
    return "not built";
}

void lws_context_destroy(struct lws_context *ctx) {
    (void) ctx;
}

void tjs__lws_setup(void) {
}

void tjs__lws_init_log_cx(TJSRuntime *qrt) {
    (void) qrt;
}

void tjs__lws_keepalive_init(TJSRuntime *qrt) {
    uv_async_init(&qrt->loop, &qrt->lws.keepalive, NULL);
    uv_unref((uv_handle_t *) &qrt->lws.keepalive);
}

int tjs__lws_load_http(TJSRuntime *qrt, TBuf *dbuf, const char *url) {
    (void) qrt;
    (void) dbuf;
    (void) url;
    return -1;
}

void tjs__mod_tls_cleanup(TJSRuntime *qrt) {
    (void) qrt;
}

void tjs__mod_tls_init(JSContext *ctx, JSValue ns) {
    (void) ctx;
    (void) ns;
}

void tjs__mod_hashing_init(JSContext *ctx, JSValue ns) {
    (void) ctx;
    (void) ns;
}

void tjs__mod_httpclient_init(JSContext *ctx, JSValue ns) {
    (void) ctx;
    (void) ns;
}

void tjs__mod_httpserver_init(JSContext *ctx, JSValue ns) {
    (void) ctx;
    (void) ns;
}

void tjs__mod_ws_init(JSContext *ctx, JSValue ns) {
    (void) ctx;
    (void) ns;
}

void tjs__mod_miniz_init(JSContext *ctx, JSValue ns) {
    (void) ctx;
    (void) ns;
}

static const char unbuilt_namespace_source[] =
    "(function (namespace) {"
    "  const member = (name) => new Proxy(function () { throw new Error('gm does not build txiki ' + name); }, {"
    "    get: (target, key) => (typeof key === 'symbol' || key in target ? target[key] : name + '.' + String(key)),"
    "  });"
    "  return new Proxy({}, { get: (target, key) => (typeof key === 'symbol' ? undefined : member(namespace + '.' + String(key))) });"
    "})";

static void define_unbuilt_namespace(JSContext *ctx, JSValue ns, const char *name) {
    JSValue factory = JS_Eval(ctx, unbuilt_namespace_source, sizeof(unbuilt_namespace_source) - 1, "<unbuilt>", JS_EVAL_TYPE_GLOBAL);
    JSValue label = JS_NewString(ctx, name);
    JSValue unbuilt = JS_Call(ctx, factory, JS_UNDEFINED, 1, &label);
    JS_FreeValue(ctx, label);
    JS_FreeValue(ctx, factory);
    JS_DefinePropertyValueStr(ctx, ns, name, unbuilt, JS_PROP_C_W_E);
}

void tjs__webcrypto_init(JSContext *ctx, JSValue ns) {
    define_unbuilt_namespace(ctx, ns, "webcrypto");
}
