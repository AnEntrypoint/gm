/*
 * txiki.js
 *
 * Copyright (c) 2019-present Saul Ibarra Corretge <s@saghul.net>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

#include "mem.h"
#include "private.h"
#include "tjs.h"
#include "utils.h"

#include <stdatomic.h>
#include <string.h>

typedef struct TJSPort TJSPort;
typedef struct TJSMailbox TJSMailbox;

static uv_once_t channel_once = UV_ONCE_INIT;

static uv_mutex_t broadcast_registry_lock;
typedef struct TJSBroadcast TJSBroadcast;
static struct list_head broadcast_registry;

static void channel_global_init(void) {
    CHECK_EQ(uv_mutex_init(&broadcast_registry_lock), 0);
    init_list_head(&broadcast_registry);
}

typedef struct {
    TJSMailbox *recv_mb;
    TJSMailbox *send_mb;
} TJSPortRef;

typedef struct TJSChannelMsg {
    struct list_head inbox_node;
    void **dup_sabs;
    int ndup_sabs;
    TJSPortRef *ports;
    int nports;
    bool is_error;
    size_t data_len;
    uint8_t data[];
} TJSChannelMsg;

enum {
    CHANNEL_DELIVER_MESSAGE = 0,
    CHANNEL_DELIVER_MESSAGE_ERROR,
    CHANNEL_DELIVER_ERROR,
};

static void port_ref_destroy(TJSPortRef *ref);
static void port_async_cb(uv_async_t *handle);

static void channel_msg_release_sabs(TJSChannelMsg *m) {
    for (int i = 0; i < m->ndup_sabs; i++) {
        tjs__sab_free(NULL, m->dup_sabs[i]);
    }
    tjs__free(m->dup_sabs);
    m->dup_sabs = NULL;
    m->ndup_sabs = 0;
}

static void channel_msg_free(TJSChannelMsg *m) {
    channel_msg_release_sabs(m);
    for (int i = 0; i < m->nports; i++) {
        port_ref_destroy(&m->ports[i]);
    }
    tjs__free(m->ports);
    tjs__free(m);
}

static TJSChannelMsg *channel_msg_build(JSContext *ctx, JSValueConst value) {
    size_t len;
    int flags = JS_WRITE_OBJ_SAB | JS_WRITE_OBJ_REFERENCE | JS_WRITE_OBJ_STRIP_SOURCE;
    JSSABTab sab_tab;
    uint8_t *buf = JS_WriteObject2(ctx, &len, value, flags, &sab_tab);
    if (!buf) {
        return NULL;
    }

    TJSChannelMsg *m = tjs__mallocz(sizeof(*m) + len);
    if (!m) {
        js_free(ctx, buf);
        js_free(ctx, sab_tab.tab);
        JS_ThrowOutOfMemory(ctx);
        return NULL;
    }
    memcpy(m->data, buf, len);
    m->data_len = len;
    js_free(ctx, buf);

    if (sab_tab.len > 0) {
        m->dup_sabs = tjs__malloc(sizeof(void *) * sab_tab.len);
        if (!m->dup_sabs) {
            js_free(ctx, sab_tab.tab);
            tjs__free(m);
            JS_ThrowOutOfMemory(ctx);
            return NULL;
        }
        for (int i = 0; i < sab_tab.len; i++) {
            m->dup_sabs[i] = sab_tab.tab[i];
            tjs__sab_dup(NULL, sab_tab.tab[i]);
        }
        m->ndup_sabs = sab_tab.len;
    }
    js_free(ctx, sab_tab.tab);

    return m;
}

static TJSChannelMsg *channel_msg_dup(const TJSChannelMsg *src) {
    TJSChannelMsg *m = tjs__mallocz(sizeof(*m) + src->data_len);
    if (!m) {
        return NULL;
    }
    memcpy(m->data, src->data, src->data_len);
    m->data_len = src->data_len;
    if (src->ndup_sabs > 0) {
        m->dup_sabs = tjs__malloc(sizeof(void *) * src->ndup_sabs);
        if (!m->dup_sabs) {
            tjs__free(m);
            return NULL;
        }
        for (int i = 0; i < src->ndup_sabs; i++) {
            m->dup_sabs[i] = src->dup_sabs[i];
            tjs__sab_dup(NULL, src->dup_sabs[i]);
        }
        m->ndup_sabs = src->ndup_sabs;
    }
    return m;
}

struct TJSMailbox {
    atomic_int refcount;
    uv_mutex_t lock;
    struct list_head messages;
    TJSPort *receiving_port;
    bool closed;
};

static TJSMailbox *mailbox_new(void) {
    TJSMailbox *mb = tjs__mallocz(sizeof(*mb));
    if (!mb) {
        return NULL;
    }
    CHECK_EQ(uv_mutex_init(&mb->lock), 0);
    atomic_init(&mb->refcount, 0);
    init_list_head(&mb->messages);
    return mb;
}

static void mailbox_ref(TJSMailbox *mb) {
    atomic_fetch_add(&mb->refcount, 1);
}

static void mailbox_close(TJSMailbox *mb) {
    struct list_head drained, *el, *el1;
    uv_mutex_lock(&mb->lock);
    mb->closed = true;
    mb->receiving_port = NULL;
    list_splice_init(&drained, &mb->messages);
    uv_mutex_unlock(&mb->lock);
    list_for_each_safe(el, el1, &drained) {
        channel_msg_free(list_entry(el, TJSChannelMsg, inbox_node));
    }
}

static void mailbox_destroy(TJSMailbox *mb) {
    CHECK_EQ(atomic_load(&mb->refcount), 0);
    struct list_head *el, *el1;
    list_for_each_safe(el, el1, &mb->messages) {
        channel_msg_free(list_entry(el, TJSChannelMsg, inbox_node));
    }
    uv_mutex_destroy(&mb->lock);
    tjs__free(mb);
}

static void mailbox_unref(TJSMailbox *mb) {
    if (atomic_fetch_sub(&mb->refcount, 1) != 1) {
        return;
    }
    mailbox_destroy(mb);
}

static void port_ref_destroy(TJSPortRef *ref) {
    mailbox_close(ref->recv_mb);
    mailbox_unref(ref->recv_mb);
    mailbox_unref(ref->send_mb);
}

typedef enum {
    PORT_UNSTARTED,
    PORT_STARTED,
    PORT_CLOSED,
    PORT_DETACHED,
} TJSPortState;

struct TJSPort {
    JSContext *ctx;
    TJSMailbox *recv_mb;
    TJSMailbox *send_mb;
    uv_async_t async;
    TJSPortState state;
    JSValue deliver_fn;
};

static TJSPort *tjs_port_get(JSContext *ctx, JSValue obj) {
    return JS_GetOpaque2(ctx, obj, tjs__class_id(ctx, TJS_CLASS_PORT));
}

static bool port_is_live(const TJSPort *p) {
    return p->state == PORT_UNSTARTED || p->state == PORT_STARTED;
}

static JSValue tjs_new_port(JSContext *ctx, TJSMailbox *rx, TJSMailbox *tx) {
    JSValue obj = JS_NewObjectClass(ctx, tjs__class_id(ctx, TJS_CLASS_PORT));
    if (JS_IsException(obj)) {
        return obj;
    }
    TJSPort *p = tjs__mallocz(sizeof(*p));
    if (!p) {
        JS_FreeValue(ctx, obj);
        return JS_ThrowOutOfMemory(ctx);
    }
    p->ctx = ctx;
    p->recv_mb = rx;
    p->send_mb = tx;
    p->state = PORT_UNSTARTED;
    p->deliver_fn = JS_UNDEFINED;
    mailbox_ref(rx);
    mailbox_ref(tx);
    CHECK_EQ(uv_async_init(tjs_get_loop(ctx), &p->async, port_async_cb), 0);
    p->async.data = p;
    uv_unref((uv_handle_t *) &p->async);
    JS_SetOpaque(obj, p);
    return obj;
}

static JSValue tjs_new_port_from_ref(JSContext *ctx, TJSPortRef *ref) {
    JSValue obj = tjs_new_port(ctx, ref->recv_mb, ref->send_mb);
    if (JS_IsException(obj)) {
        port_ref_destroy(ref);
        return obj;
    }
    mailbox_unref(ref->recv_mb);
    mailbox_unref(ref->send_mb);
    return obj;
}

static JSValue port_build_ports(JSContext *ctx, TJSChannelMsg *m) {
    if (m->nports == 0) {
        return JS_UNDEFINED;
    }
    JSValue ports = JS_NewArray(ctx);
    if (JS_IsException(ports)) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        return JS_UNDEFINED;
    }
    JS_SetPropertyStr(ctx, ports, "length", JS_NewUint32(ctx, m->nports));
    for (int i = 0; i < m->nports; i++) {
        JS_SetPropertyUint32(ctx, ports, i, tjs_new_port_from_ref(ctx, &m->ports[i]));
    }
    m->nports = 0;
    return ports;
}

static void port_dispatch_one(JSContext *ctx, TJSPort *p, TJSChannelMsg *m) {
    JSSABTab sab_tab = { .tab = NULL, .len = 0 };
    JSValue data = JS_ReadObject2(ctx, m->data, m->data_len, JS_READ_OBJ_SAB | JS_READ_OBJ_REFERENCE, &sab_tab);
    js_free(ctx, sab_tab.tab);

    JSValue ports;
    int kind;
    if (JS_IsException(data)) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        data = JS_UNDEFINED;
        ports = JS_UNDEFINED;
        kind = CHANNEL_DELIVER_MESSAGE_ERROR;
    } else {
        ports = port_build_ports(ctx, m);
        kind = m->is_error ? CHANNEL_DELIVER_ERROR : CHANNEL_DELIVER_MESSAGE;
    }

    CHECK(JS_IsFunction(ctx, p->deliver_fn));
    JSValue args[3] = { data, ports, JS_NewInt32(ctx, kind) };
    tjs_call_handler(ctx, p->deliver_fn, 3, args);

    JS_FreeValue(ctx, data);
    JS_FreeValue(ctx, ports);
}

static void port_drain(TJSPort *p) {
    JSContext *ctx = p->ctx;

    if (!port_is_live(p)) {
        return;
    }

    struct list_head inbox, *el, *el1;
    uv_mutex_lock(&p->recv_mb->lock);
    list_splice_init(&inbox, &p->recv_mb->messages);
    uv_mutex_unlock(&p->recv_mb->lock);

    list_for_each_safe(el, el1, &inbox) {
        TJSChannelMsg *m = list_entry(el, TJSChannelMsg, inbox_node);

        if (!port_is_live(p)) {
            channel_msg_free(m);
            continue;
        }

        port_dispatch_one(ctx, p, m);
        channel_msg_free(m);
    }
}

static void port_async_cb(uv_async_t *handle) {
    TJSPort *p = handle->data;
    CHECK_NOT_NULL(p);
    port_drain(p);
}

static void port_async_close_cb(uv_handle_t *handle) {
    TJSPort *p = handle->data;
    CHECK_NOT_NULL(p);
    tjs__free(p);
}

static void port_release_mailboxes(TJSPort *p) {
    if (p->recv_mb) {
        mailbox_close(p->recv_mb);
        mailbox_unref(p->recv_mb);
        p->recv_mb = NULL;
    }
    if (p->send_mb) {
        mailbox_unref(p->send_mb);
        p->send_mb = NULL;
    }
}

static void port_do_close(TJSPort *p) {
    if (!port_is_live(p)) {
        return;
    }
    p->state = PORT_CLOSED;
    port_release_mailboxes(p);
    uv_unref((uv_handle_t *) &p->async);
}

static void port_do_transfer(TJSPort *p, TJSPortRef *out) {
    uv_mutex_lock(&p->recv_mb->lock);
    CHECK(p->recv_mb->receiving_port == p || p->recv_mb->receiving_port == NULL);
    p->recv_mb->receiving_port = NULL;
    uv_mutex_unlock(&p->recv_mb->lock);

    uv_unref((uv_handle_t *) &p->async);

    out->recv_mb = p->recv_mb;
    out->send_mb = p->send_mb;
    p->recv_mb = NULL;
    p->send_mb = NULL;
    p->state = PORT_DETACHED;
}

static void tjs_port_finalizer(JSRuntime *rt, JSValue val) {
    TJSPort *p = JS_GetOpaque(val, tjs__class_id_rt(rt, TJS_CLASS_PORT));
    if (!p) {
        return;
    }

    JS_FreeValueRT(rt, p->deliver_fn);
    p->deliver_fn = JS_UNDEFINED;

    port_do_close(p);

    uv_close((uv_handle_t *) &p->async, port_async_close_cb);
}

static void tjs_port_mark(JSRuntime *rt, JSValue val, JS_MarkFunc *mark_func) {
    TJSPort *p = JS_GetOpaque(val, tjs__class_id_rt(rt, TJS_CLASS_PORT));
    if (p) {
        JS_MarkValue(rt, p->deliver_fn, mark_func);
    }
}

static JSClassDef tjs_port_class = {
    "MessagePortHandle",
    .finalizer = tjs_port_finalizer,
    .gc_mark = tjs_port_mark,
};

static void port_post(TJSPort *p, TJSChannelMsg *m) {
    TJSMailbox *mb = p->send_mb;

    for (int i = 0; i < m->nports; i++) {
        if (m->ports[i].recv_mb == mb) {
            channel_msg_free(m);
            return;
        }
    }

    uv_mutex_lock(&mb->lock);
    if (mb->closed) {
        uv_mutex_unlock(&mb->lock);
        channel_msg_free(m);
        return;
    }
    list_add_tail(&m->inbox_node, &mb->messages);
    if (mb->receiving_port) {
        uv_async_send(&mb->receiving_port->async);
    }
    uv_mutex_unlock(&mb->lock);
}

static JSValue tjs_port_postmessage(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    TJSPort *p = tjs_port_get(ctx, this_val);
    if (!p) {
        return JS_EXCEPTION;
    }
    if (!port_is_live(p)) {
        return JS_ThrowTypeError(ctx, "port is detached");
    }

    JSValue value = argv[0];
    JSValue port_handles = argv[1];
    JSValue buffers = argv[2];

    int64_t nports = 0;
    if (JS_IsArray(port_handles)) {
        JS_GetLength(ctx, port_handles, &nports);
    }
    int64_t nbufs = 0;
    if (JS_IsArray(buffers)) {
        JS_GetLength(ctx, buffers, &nbufs);
    }

    TJSChannelMsg *m = channel_msg_build(ctx, value);
    if (!m) {
        return JS_EXCEPTION;
    }

    if (nports > 0) {
        m->ports = tjs__malloc(sizeof(TJSPortRef) * nports);
        if (!m->ports) {
            channel_msg_free(m);
            return JS_ThrowOutOfMemory(ctx);
        }
    }

    int64_t nvals = nports + nbufs;
    JSValue *vals = NULL;
    if (nvals > 0) {
        vals = tjs__malloc(sizeof(JSValue) * nvals);
        if (!vals) {
            channel_msg_free(m);
            return JS_ThrowOutOfMemory(ctx);
        }
        for (int64_t i = 0; i < nports; i++) {
            vals[i] = JS_GetPropertyUint32(ctx, port_handles, (uint32_t) i);
        }
        for (int64_t i = 0; i < nbufs; i++) {
            vals[nports + i] = JS_GetPropertyUint32(ctx, buffers, (uint32_t) i);
        }
    }
    JSValue *bufs = vals ? vals + nports : NULL;

    bool pinned = false;
    for (int64_t i = 0; i < nbufs; i++) {
        if (JS_IsImmutableArrayBuffer(bufs[i]) == 1) {
            pinned = true;
            break;
        }
    }

    if (!pinned) {
        for (int64_t i = 0; i < nports; i++) {
            TJSPort *tp = tjs_port_get(ctx, vals[i]);
            if (tp && port_is_live(tp)) {
                port_do_transfer(tp, &m->ports[m->nports++]);
            }
        }
        for (int64_t i = 0; i < nbufs; i++) {
            if (JS_IsArrayBuffer(bufs[i])) {
                JS_DetachArrayBuffer(ctx, bufs[i]);
            }
        }
    }

    for (int64_t i = 0; i < nvals; i++) {
        JS_FreeValue(ctx, vals[i]);
    }
    tjs__free(vals);

    if (pinned) {
        channel_msg_free(m);
        return JS_ThrowTypeError(ctx, "Cannot transfer an immutable ArrayBuffer");
    }

    port_post(p, m);

    return JS_UNDEFINED;
}

static JSValue tjs_port_deliver_default(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv, int magic, JSValue *func_data) {
    if (argc < 3) {
        return JS_UNDEFINED;
    }
    int kind;
    if (JS_ToInt32(ctx, &kind, argv[2])) {
        return JS_EXCEPTION;
    }
    const char *handler_name = "onmessage";
    if (kind == CHANNEL_DELIVER_MESSAGE_ERROR) {
        handler_name = "onmessageerror";
    } else if (kind == CHANNEL_DELIVER_ERROR) {
        handler_name = "onerror";
    }

    JSValue handler = JS_GetPropertyStr(ctx, func_data[0], handler_name);
    if (!JS_IsFunction(ctx, handler)) {
        JS_FreeValue(ctx, handler);
        return JS_UNDEFINED;
    }

    JSValue event = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, event, "data", JS_DupValue(ctx, argv[0]));
    JS_SetPropertyStr(ctx, event, "ports", JS_DupValue(ctx, argv[1]));
    JSValue ret = JS_Call(ctx, handler, func_data[0], 1, &event);
    JS_FreeValue(ctx, event);
    JS_FreeValue(ctx, handler);
    return ret;
}

static JSValue tjs_port_start(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    TJSPort *p = tjs_port_get(ctx, this_val);
    if (!p) {
        return JS_EXCEPTION;
    }
    if (p->state != PORT_UNSTARTED) {
        return JS_UNDEFINED;
    }

    JS_FreeValue(ctx, p->deliver_fn);
    if (argc > 0 && JS_IsFunction(ctx, argv[0])) {
        p->deliver_fn = JS_DupValue(ctx, argv[0]);
    } else {
        JSValue port_ref = JS_DupValue(ctx, this_val);
        p->deliver_fn = JS_NewCFunctionData(ctx, tjs_port_deliver_default, 3, 0, 1, &port_ref);
        JS_FreeValue(ctx, port_ref);
    }

    uv_ref((uv_handle_t *) &p->async);

    uv_mutex_lock(&p->recv_mb->lock);
    CHECK_NULL(p->recv_mb->receiving_port);
    p->recv_mb->receiving_port = p;
    p->state = PORT_STARTED;
    uv_mutex_unlock(&p->recv_mb->lock);

    uv_async_send(&p->async);

    return JS_UNDEFINED;
}

static JSValue tjs_port_close(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    TJSPort *p = tjs_port_get(ctx, this_val);
    if (!p) {
        return JS_EXCEPTION;
    }
    port_do_close(p);
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry tjs_port_proto_funcs[] = {
    TJS_CFUNC_DEF("postMessage", 3, tjs_port_postmessage),
    TJS_CFUNC_DEF("start", 1, tjs_port_start),
    TJS_CFUNC_DEF("close", 0, tjs_port_close),
};

static JSValue tjs_channel_new(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    TJSMailbox *m0 = mailbox_new();
    TJSMailbox *m1 = mailbox_new();
    if (!m0 || !m1) {
        if (m0) {
            mailbox_destroy(m0);
        }
        if (m1) {
            mailbox_destroy(m1);
        }
        return JS_ThrowOutOfMemory(ctx);
    }

    JSValue a = tjs_new_port(ctx, m0, m1);
    if (JS_IsException(a)) {
        mailbox_destroy(m0);
        mailbox_destroy(m1);
        return a;
    }

    JSValue b = tjs_new_port(ctx, m1, m0);
    if (JS_IsException(b)) {
        JS_FreeValue(ctx, a);
        return b;
    }

    JSValue arr = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, arr, 0, a);
    JS_SetPropertyUint32(ctx, arr, 1, b);
    return arr;
}

bool tjs__channel_mailbox_pair(TJSMailbox **a, TJSMailbox **b) {
    TJSMailbox *m0 = mailbox_new();
    TJSMailbox *m1 = mailbox_new();
    if (!m0 || !m1) {
        if (m0) {
            mailbox_destroy(m0);
        }
        if (m1) {
            mailbox_destroy(m1);
        }
        return false;
    }
    mailbox_ref(m0);
    mailbox_ref(m1);
    *a = m0;
    *b = m1;
    return true;
}

JSValue tjs__channel_port_new(JSContext *ctx, TJSMailbox *rx, TJSMailbox *tx) {
    return tjs_new_port(ctx, rx, tx);
}

void tjs__channel_mailbox_unref(TJSMailbox *mb) {
    mailbox_unref(mb);
}

void tjs__channel_port_close(JSRuntime *rt, JSValue port_handle) {
    TJSPort *p = JS_GetOpaque(port_handle, tjs__class_id_rt(rt, TJS_CLASS_PORT));
    if (p) {
        port_do_close(p);
    }
}

void tjs__channel_port_flush(JSRuntime *rt, JSValue port_handle) {
    TJSPort *p = JS_GetOpaque(port_handle, tjs__class_id_rt(rt, TJS_CLASS_PORT));
    if (p && p->state == PORT_STARTED) {
        port_drain(p);
    }
}

void tjs__channel_port_unref(JSRuntime *rt, JSValue port_handle) {
    TJSPort *p = JS_GetOpaque(port_handle, tjs__class_id_rt(rt, TJS_CLASS_PORT));
    if (p) {
        uv_unref((uv_handle_t *) &p->async);
    }
}

void tjs__channel_port_post_error(JSContext *ctx, JSValue port_handle, JSValueConst error_obj) {
    TJSPort *p = JS_GetOpaque(port_handle, tjs__class_id(ctx, TJS_CLASS_PORT));
    if (!p || !port_is_live(p)) {
        return;
    }
    TJSChannelMsg *m = channel_msg_build(ctx, error_obj);
    if (!m) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        return;
    }
    m->is_error = true;
    port_post(p, m);
}

struct TJSBroadcast {
    JSContext *ctx;
    uv_async_t async;
    bool closed;
    JSValue deliver_fn;
    uv_mutex_t messages_lock;
    struct list_head messages;
    struct list_head registry_node;
    char name[];
};

static TJSBroadcast *tjs_broadcast_get(JSContext *ctx, JSValue obj) {
    return JS_GetOpaque2(ctx, obj, tjs__class_id(ctx, TJS_CLASS_BROADCAST));
}

static void broadcast_dispatch_one(JSContext *ctx, TJSBroadcast *bc, TJSChannelMsg *m) {
    JSSABTab sab_tab = { .tab = NULL, .len = 0 };
    JSValue data = JS_ReadObject2(ctx, m->data, m->data_len, JS_READ_OBJ_SAB | JS_READ_OBJ_REFERENCE, &sab_tab);
    js_free(ctx, sab_tab.tab);
    bool deser_failed = JS_IsException(data);
    if (deser_failed) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        data = JS_UNDEFINED;
    }

    CHECK(JS_IsFunction(ctx, bc->deliver_fn));
    JSValue args[2] = { data, JS_NewBool(ctx, deser_failed) };
    tjs_call_handler(ctx, bc->deliver_fn, 2, args);

    JS_FreeValue(ctx, data);
}

static void broadcast_async_cb(uv_async_t *handle) {
    TJSBroadcast *bc = handle->data;
    CHECK_NOT_NULL(bc);

    struct list_head inbox, *el, *el1;
    uv_mutex_lock(&bc->messages_lock);
    list_splice_init(&inbox, &bc->messages);
    uv_mutex_unlock(&bc->messages_lock);

    list_for_each_safe(el, el1, &inbox) {
        TJSChannelMsg *m = list_entry(el, TJSChannelMsg, inbox_node);
        if (bc->closed) {
            channel_msg_free(m);
            continue;
        }
        broadcast_dispatch_one(bc->ctx, bc, m);
        channel_msg_free(m);
    }
}

static void broadcast_async_close_cb(uv_handle_t *handle) {
    TJSBroadcast *bc = handle->data;
    CHECK_NOT_NULL(bc);
    uv_mutex_destroy(&bc->messages_lock);
    tjs__free(bc);
}

static void broadcast_do_close(TJSBroadcast *bc) {
    if (bc->closed) {
        return;
    }
    bc->closed = true;

    uv_mutex_lock(&broadcast_registry_lock);
    list_del(&bc->registry_node);
    uv_mutex_unlock(&broadcast_registry_lock);

    struct list_head inbox, *el, *el1;
    uv_mutex_lock(&bc->messages_lock);
    list_splice_init(&inbox, &bc->messages);
    uv_mutex_unlock(&bc->messages_lock);
    list_for_each_safe(el, el1, &inbox) {
        channel_msg_free(list_entry(el, TJSChannelMsg, inbox_node));
    }
}

static void tjs_broadcast_finalizer(JSRuntime *rt, JSValue val) {
    TJSBroadcast *bc = JS_GetOpaque(val, tjs__class_id_rt(rt, TJS_CLASS_BROADCAST));
    if (!bc) {
        return;
    }
    JS_FreeValueRT(rt, bc->deliver_fn);
    bc->deliver_fn = JS_UNDEFINED;
    broadcast_do_close(bc);
    uv_close((uv_handle_t *) &bc->async, broadcast_async_close_cb);
}

static void tjs_broadcast_mark(JSRuntime *rt, JSValue val, JS_MarkFunc *mark_func) {
    TJSBroadcast *bc = JS_GetOpaque(val, tjs__class_id_rt(rt, TJS_CLASS_BROADCAST));
    if (bc) {
        JS_MarkValue(rt, bc->deliver_fn, mark_func);
    }
}

static JSClassDef tjs_broadcast_class = {
    "BroadcastChannelHandle",
    .finalizer = tjs_broadcast_finalizer,
    .gc_mark = tjs_broadcast_mark,
};

static JSValue tjs_broadcast_new(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    uv_once(&channel_once, channel_global_init);

    const char *name = JS_ToCString(ctx, argv[0]);
    if (!name) {
        return JS_EXCEPTION;
    }

    JSValue obj = JS_NewObjectClass(ctx, tjs__class_id(ctx, TJS_CLASS_BROADCAST));
    if (JS_IsException(obj)) {
        JS_FreeCString(ctx, name);
        return obj;
    }

    size_t namelen = strlen(name);
    TJSBroadcast *bc = tjs__mallocz(sizeof(*bc) + namelen + 1);
    if (!bc) {
        JS_FreeCString(ctx, name);
        JS_FreeValue(ctx, obj);
        return JS_ThrowOutOfMemory(ctx);
    }
    bc->ctx = ctx;
    memcpy(bc->name, name, namelen + 1);
    JS_FreeCString(ctx, name);
    bc->deliver_fn = JS_DupValue(ctx, argv[1]);
    init_list_head(&bc->messages);

    CHECK_EQ(uv_mutex_init(&bc->messages_lock), 0);

    CHECK_EQ(uv_async_init(tjs_get_loop(ctx), &bc->async, broadcast_async_cb), 0);
    bc->async.data = bc;
    uv_unref((uv_handle_t *) &bc->async);

    uv_mutex_lock(&broadcast_registry_lock);
    list_add(&bc->registry_node, &broadcast_registry);
    uv_mutex_unlock(&broadcast_registry_lock);

    JS_SetOpaque(obj, bc);
    return obj;
}

static JSValue tjs_broadcast_postmessage(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    TJSBroadcast *sender = tjs_broadcast_get(ctx, this_val);
    if (!sender) {
        return JS_EXCEPTION;
    }
    if (sender->closed) {
        return JS_ThrowTypeError(ctx, "BroadcastChannel is closed");
    }

    TJSChannelMsg *src_msg = channel_msg_build(ctx, argv[0]);
    if (!src_msg) {
        return JS_EXCEPTION;
    }

    uv_mutex_lock(&broadcast_registry_lock);
    struct list_head *el;
    list_for_each(el, &broadcast_registry) {
        TJSBroadcast *bc = list_entry(el, TJSBroadcast, registry_node);
        if (bc == sender || bc->closed || strcmp(bc->name, sender->name) != 0) {
            continue;
        }

        TJSChannelMsg *m = channel_msg_dup(src_msg);
        if (!m) {
            continue;
        }

        uv_mutex_lock(&bc->messages_lock);
        list_add_tail(&m->inbox_node, &bc->messages);
        uv_mutex_unlock(&bc->messages_lock);

        uv_async_send(&bc->async);
    }
    uv_mutex_unlock(&broadcast_registry_lock);

    channel_msg_free(src_msg);

    return JS_UNDEFINED;
}

static JSValue tjs_broadcast_close(JSContext *ctx, JSValue this_val, int argc, JSValue *argv) {
    TJSBroadcast *bc = tjs_broadcast_get(ctx, this_val);
    if (!bc) {
        return JS_EXCEPTION;
    }
    broadcast_do_close(bc);
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry tjs_broadcast_proto_funcs[] = {
    TJS_CFUNC_DEF("postMessage", 1, tjs_broadcast_postmessage),
    TJS_CFUNC_DEF("close", 0, tjs_broadcast_close),
};

void tjs__mod_channel_init(JSContext *ctx, JSValue ns) {
    JSValue proto;

    CHECK_EQ(tjs__class_register(ctx, TJS_CLASS_PORT, &tjs_port_class), 0);
    proto = JS_NewObject(ctx);
    JS_SetPropertyFunctionList(ctx, proto, tjs_port_proto_funcs, countof(tjs_port_proto_funcs));
    JS_SetClassProto(ctx, tjs__class_id(ctx, TJS_CLASS_PORT), proto);

    CHECK_EQ(tjs__class_register(ctx, TJS_CLASS_BROADCAST, &tjs_broadcast_class), 0);
    proto = JS_NewObject(ctx);
    JS_SetPropertyFunctionList(ctx, proto, tjs_broadcast_proto_funcs, countof(tjs_broadcast_proto_funcs));
    JS_SetClassProto(ctx, tjs__class_id(ctx, TJS_CLASS_BROADCAST), proto);

    JS_DefinePropertyValueStr(ctx,
                              ns,
                              "channelNew",
                              JS_NewCFunction(ctx, tjs_channel_new, "channelNew", 0),
                              JS_PROP_C_W_E);
    JS_DefinePropertyValueStr(ctx,
                              ns,
                              "broadcastNew",
                              JS_NewCFunction(ctx, tjs_broadcast_new, "broadcastNew", 2),
                              JS_PROP_C_W_E);
}
