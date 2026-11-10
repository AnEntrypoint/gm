#ifndef GM_TXIKI_OVERLAY_LIBWEBSOCKETS_H
#define GM_TXIKI_OVERLAY_LIBWEBSOCKETS_H

#include <stddef.h>

struct lws_context;
struct lws_vhost;

typedef struct lws_log_cx {
    int refcount;
} lws_log_cx_t;

typedef struct lws_plugin_evlib {
    int placeholder;
} lws_plugin_evlib_t;

const char *lws_get_library_version(void);
void lws_context_destroy(struct lws_context *ctx);

#endif
