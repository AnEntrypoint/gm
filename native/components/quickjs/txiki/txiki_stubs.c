#include "private.h"

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

void tjs__webcrypto_init(JSContext *ctx, JSValue ns) {
    (void) ctx;
    (void) ns;
}
