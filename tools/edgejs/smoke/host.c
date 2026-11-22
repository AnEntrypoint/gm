#include <node_api.h>

static napi_value host_sum(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    double left = 0;
    double right = 0;
    napi_value result;
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_get_value_double(env, argv[0], &left);
    napi_get_value_double(env, argv[1], &right);
    napi_create_double(env, left + right, &result);
    return result;
}

static napi_value host_init(napi_env env, napi_value exports) {
    napi_value sum;
    napi_create_function(env, "sum", NAPI_AUTO_LENGTH, host_sum, NULL, &sum);
    napi_set_named_property(env, exports, "sum", sum);
    return exports;
}

NAPI_MODULE(gm_spike_host, host_init)
