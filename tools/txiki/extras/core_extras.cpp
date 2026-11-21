#include "core_extras.hpp"

#include <brotli/decode.h>
#include <zstd.h>

#include <csignal>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace gm::core_extras {
namespace {

class Scoped {
public:
    Scoped(JSContext* ctx, JSValue value) : ctx_(ctx), value_(value) {}
    Scoped(const Scoped&) = delete;
    Scoped& operator=(const Scoped&) = delete;
    ~Scoped() { JS_FreeValue(ctx_, value_); }
    JSValueConst get() const { return value_; }

private:
    JSContext* ctx_;
    JSValue value_;
};

constexpr std::size_t default_max_buffer = 1024 * 1024;
constexpr std::size_t decoded_limit = std::size_t{1} << 30;

SpawnSync host_spawn = nullptr;

struct SignalName {
    const char* name;
    int number;
};

#if defined(_WIN32)
constexpr SignalName signal_names[] = {};
#else
constexpr SignalName signal_names[] = {
    {"SIGHUP", SIGHUP}, {"SIGINT", SIGINT}, {"SIGQUIT", SIGQUIT}, {"SIGKILL", SIGKILL}, {"SIGTERM", SIGTERM}, {"SIGUSR1", SIGUSR1}, {"SIGUSR2", SIGUSR2}, {"SIGPIPE", SIGPIPE},
    {"SIGALRM", SIGALRM}, {"SIGABRT", SIGABRT}, {"SIGSEGV", SIGSEGV}, {"SIGBUS", SIGBUS}, {"SIGFPE", SIGFPE}, {"SIGILL", SIGILL}, {"SIGTRAP", SIGTRAP}};
#endif

std::string text_of(JSContext* ctx, JSValueConst value) {
    std::size_t size = 0;
    const char* data = JS_ToCStringLen(ctx, &size, value);
    if (data == nullptr) return {};
    std::string text(data, size);
    JS_FreeCString(ctx, data);
    return text;
}

std::string bytes_or_text_of(JSContext* ctx, JSValueConst value) {
    if (JS_IsString(value)) return text_of(ctx, value);
    std::size_t size = 0;
    if (const std::uint8_t* typed = JS_GetUint8Array(ctx, &size, value)) return std::string(reinterpret_cast<const char*>(typed), size);
    if (const std::uint8_t* buffer = JS_GetArrayBuffer(ctx, &size, value)) return std::string(reinterpret_cast<const char*>(buffer), size);
    JS_FreeValue(ctx, JS_GetException(ctx));
    return {};
}

bool present(JSValueConst value) {
    return !JS_IsUndefined(value) && !JS_IsNull(value);
}

JSValue property(JSContext* ctx, JSValueConst object, const char* name) {
    return JS_GetPropertyStr(ctx, object, name);
}

std::optional<std::vector<std::string>> environment_of(JSContext* ctx, JSValueConst env) {
    if (!present(env)) return std::nullopt;
    std::vector<std::string> lines;
    JSPropertyEnum* names = nullptr;
    std::uint32_t count = 0;
    if (JS_GetOwnPropertyNames(ctx, &names, &count, env, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0) return std::nullopt;
    for (std::uint32_t at = 0; at < count; ++at) {
        Scoped key(ctx, JS_AtomToString(ctx, names[at].atom));
        Scoped value(ctx, JS_GetProperty(ctx, env, names[at].atom));
        if (JS_IsUndefined(value.get())) continue;
        lines.push_back(text_of(ctx, key.get()) + "=" + text_of(ctx, value.get()));
    }
    JS_FreePropertyEnum(ctx, names, count);
    return lines;
}

int signal_number_of(JSContext* ctx, JSValueConst value) {
    if (!present(value)) return 0;
    if (JS_IsNumber(value)) {
        std::int32_t number = 0;
        JS_ToInt32(ctx, &number, value);
        return number;
    }
    const std::string name = text_of(ctx, value);
    for (const SignalName& known : signal_names) {
        if (name == known.name) return known.number;
    }
    return 0;
}

const char* signal_name_of(int number) {
    for (const SignalName& known : signal_names) {
        if (number == known.number) return known.name;
    }
    return nullptr;
}

JSValue error_object(JSContext* ctx, const std::string& code, const std::string& message) {
    JSValue error = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, error, "code", JS_NewString(ctx, code.c_str()));
    JS_SetPropertyStr(ctx, error, "message", JS_NewString(ctx, message.c_str()));
    return error;
}

std::vector<std::string> command_line_of(JSContext* ctx, JSValueConst file, JSValueConst args, JSValueConst shell) {
    std::vector<std::string> argv{text_of(ctx, file)};
    Scoped length(ctx, property(ctx, args, "length"));
    std::uint32_t count = 0;
    JS_ToUint32(ctx, &count, length.get());
    for (std::uint32_t at = 0; at < count; ++at) {
        Scoped item(ctx, JS_GetPropertyUint32(ctx, args, at));
        argv.push_back(text_of(ctx, item.get()));
    }
    if (!present(shell) || (JS_IsBool(shell) && !JS_ToBool(ctx, shell))) return argv;
    std::string joined = argv.front();
    for (std::size_t at = 1; at < argv.size(); ++at) joined += " " + argv[at];
#if defined(_WIN32)
    return {JS_IsString(shell) ? text_of(ctx, shell) : "cmd.exe", "/d", "/s", "/c", joined};
#else
    return {JS_IsString(shell) ? text_of(ctx, shell) : "/bin/sh", "-c", joined};
#endif
}

JSValue spawn_sync(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(ctx, "spawnSync needs a file name");
    const JSValueConst args = argc > 1 && !JS_IsUndefined(argv[1]) ? argv[1] : JS_UNDEFINED;
    Scoped no_args(ctx, JS_NewArray(ctx));
    const JSValueConst options = argc > 2 && JS_IsObject(argv[2]) ? argv[2] : JS_UNDEFINED;
    Scoped cwd(ctx, JS_IsObject(options) ? property(ctx, options, "cwd") : JS_UNDEFINED);
    Scoped env(ctx, JS_IsObject(options) ? property(ctx, options, "env") : JS_UNDEFINED);
    Scoped input(ctx, JS_IsObject(options) ? property(ctx, options, "input") : JS_UNDEFINED);
    Scoped timeout(ctx, JS_IsObject(options) ? property(ctx, options, "timeout") : JS_UNDEFINED);
    Scoped kill_signal(ctx, JS_IsObject(options) ? property(ctx, options, "killSignal") : JS_UNDEFINED);
    Scoped max_buffer(ctx, JS_IsObject(options) ? property(ctx, options, "maxBuffer") : JS_UNDEFINED);
    Scoped shell(ctx, JS_IsObject(options) ? property(ctx, options, "shell") : JS_UNDEFINED);

    const std::vector<std::string> command = command_line_of(ctx, argv[0], JS_IsObject(args) ? args : no_args.get(), shell.get());
    SpawnRequest request;
    request.command = command;
    if (present(input.get())) request.stdin_text = bytes_or_text_of(ctx, input.get());
    if (present(cwd.get())) request.cwd = text_of(ctx, cwd.get());
    request.env = environment_of(ctx, env.get());
    request.kill_signal = signal_number_of(ctx, kill_signal.get());
    if (present(timeout.get())) {
        std::int64_t milliseconds = 0;
        JS_ToInt64(ctx, &milliseconds, timeout.get());
        request.timeout_ms = milliseconds > 0 ? static_cast<std::uint64_t>(milliseconds) : 0;
    }
    std::uint32_t limit = default_max_buffer;
    if (present(max_buffer.get())) JS_ToUint32(ctx, &limit, max_buffer.get());

    SpawnOutcome outcome = host_spawn(request);
    const bool overflowed = outcome.out.size() > limit || outcome.err.size() > limit;
    if (outcome.out.size() > limit) outcome.out.resize(limit);
    if (outcome.err.size() > limit) outcome.err.resize(limit);

    JSValue result = JS_NewObject(ctx);
    const bool signalled = outcome.started && outcome.signal > 0;
    JS_SetPropertyStr(ctx, result, "pid", JS_NewInt64(ctx, outcome.pid));
    JS_SetPropertyStr(ctx, result, "status", outcome.started && !signalled && !outcome.timed_out ? JS_NewInt32(ctx, outcome.exit_code) : JS_NULL);
    const char* signal = signalled ? signal_name_of(outcome.signal) : nullptr;
    JS_SetPropertyStr(ctx, result, "signal", signal != nullptr ? JS_NewString(ctx, signal) : JS_NULL);
    JS_SetPropertyStr(ctx, result, "stdout", JS_NewUint8ArrayCopy(ctx, reinterpret_cast<const std::uint8_t*>(outcome.out.data()), outcome.out.size()));
    JS_SetPropertyStr(ctx, result, "stderr", JS_NewUint8ArrayCopy(ctx, reinterpret_cast<const std::uint8_t*>(outcome.err.data()), outcome.err.size()));
    if (!outcome.started) {
        const std::string file = command.front();
        std::error_code ignored;
        const bool exists = file.find('/') != std::string::npos && std::filesystem::exists(file, ignored);
        JS_SetPropertyStr(ctx, result, "error", error_object(ctx, exists ? "EACCES" : "ENOENT", "spawnSync " + file + (exists ? " EACCES" : " ENOENT")));
    } else if (outcome.timed_out) {
        JS_SetPropertyStr(ctx, result, "error", error_object(ctx, "ETIMEDOUT", "spawnSync " + command.front() + " ETIMEDOUT"));
    } else if (overflowed) {
        JS_SetPropertyStr(ctx, result, "error", error_object(ctx, "ENOBUFS", "spawnSync " + command.front() + " ENOBUFS"));
    }
    return result;
}

const std::uint8_t* input_bytes(JSContext* ctx, JSValueConst value, std::size_t& size) {
    if (const std::uint8_t* typed = JS_GetUint8Array(ctx, &size, value)) return typed;
    JS_FreeValue(ctx, JS_GetException(ctx));
    return JS_GetArrayBuffer(ctx, &size, value);
}

JSValue decoded_bytes(JSContext* ctx, const std::string& decoded) {
    return JS_NewUint8ArrayCopy(ctx, reinterpret_cast<const std::uint8_t*>(decoded.data()), decoded.size());
}

JSValue zstd_decompress(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    std::size_t size = 0;
    const std::uint8_t* data = argc > 0 ? input_bytes(ctx, argv[0], size) : nullptr;
    if (data == nullptr || size == 0) return JS_ThrowTypeError(ctx, "zstdDecompress needs the bytes of a frame");
    const std::unique_ptr<ZSTD_DCtx, decltype(&ZSTD_freeDCtx)> context(ZSTD_createDCtx(), ZSTD_freeDCtx);
    std::string decoded;
    std::vector<char> chunk(ZSTD_DStreamOutSize());
    ZSTD_inBuffer input{data, size, 0};
    std::size_t pending = 0;
    for (;;) {
        ZSTD_outBuffer output{chunk.data(), chunk.size(), 0};
        pending = ZSTD_decompressStream(context.get(), &output, &input);
        if (ZSTD_isError(pending)) return JS_ThrowPlainError(ctx, "zstd: %s", ZSTD_getErrorName(pending));
        decoded.append(chunk.data(), output.pos);
        if (decoded.size() > decoded_limit) return JS_ThrowRangeError(ctx, "zstd: the output is larger than %zu bytes", decoded_limit);
        if (input.pos == input.size && output.pos < output.size) break;
    }
    if (pending != 0) return JS_ThrowPlainError(ctx, "zstd: the frame is truncated");
    return decoded_bytes(ctx, decoded);
}

JSValue brotli_decompress(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    std::size_t size = 0;
    const std::uint8_t* data = argc > 0 ? input_bytes(ctx, argv[0], size) : nullptr;
    if (data == nullptr || size == 0) return JS_ThrowTypeError(ctx, "brotliDecompress needs the bytes of a stream");
    const std::unique_ptr<BrotliDecoderState, decltype(&BrotliDecoderDestroyInstance)> state(BrotliDecoderCreateInstance(nullptr, nullptr, nullptr), BrotliDecoderDestroyInstance);
    std::string decoded;
    std::vector<std::uint8_t> chunk(1 << 16);
    const std::uint8_t* next_in = data;
    std::size_t available_in = size;
    for (;;) {
        std::size_t available_out = chunk.size();
        std::uint8_t* next_out = chunk.data();
        const BrotliDecoderResult result = BrotliDecoderDecompressStream(state.get(), &available_in, &next_in, &available_out, &next_out, nullptr);
        decoded.append(reinterpret_cast<const char*>(chunk.data()), chunk.size() - available_out);
        if (decoded.size() > decoded_limit) return JS_ThrowRangeError(ctx, "brotli: the output is larger than %zu bytes", decoded_limit);
        if (result == BROTLI_DECODER_RESULT_SUCCESS) break;
        if (result == BROTLI_DECODER_RESULT_ERROR) return JS_ThrowPlainError(ctx, "brotli: %s", BrotliDecoderErrorString(BrotliDecoderGetErrorCode(state.get())));
        if (result == BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT) return JS_ThrowPlainError(ctx, "brotli: the stream is truncated");
    }
    return decoded_bytes(ctx, decoded);
}

JSClassID realm_class_id = 0;

void finalize_realm(JSRuntime*, JSValue value) {
    if (auto* realm = static_cast<JSContext*>(JS_GetOpaque(value, realm_class_id))) JS_FreeContext(realm);
}

JSValue create_realm(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    JSContext* realm = JS_NewContext(JS_GetRuntime(ctx));
    if (realm == nullptr) return JS_ThrowOutOfMemory(ctx);
    JSValue holder = JS_NewObjectClass(ctx, realm_class_id);
    if (JS_IsException(holder)) {
        JS_FreeContext(realm);
        return holder;
    }
    JS_SetOpaque(holder, realm);
    return holder;
}

void copy_enumerable(JSContext* from_ctx, JSValueConst from, JSContext* to_ctx, JSValueConst to) {
    JSPropertyEnum* names = nullptr;
    std::uint32_t count = 0;
    if (JS_GetOwnPropertyNames(from_ctx, &names, &count, from, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0) return;
    for (std::uint32_t at = 0; at < count; ++at) {
        JSValue value = JS_GetProperty(from_ctx, from, names[at].atom);
        if (JS_IsException(value)) {
            JS_FreeValue(from_ctx, JS_GetException(from_ctx));
            continue;
        }
        JS_SetProperty(to_ctx, to, names[at].atom, value);
    }
    JS_FreePropertyEnum(from_ctx, names, count);
}

JSValue run_in_realm(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 4) return JS_ThrowTypeError(ctx, "vmRunInContext needs a context, a sandbox, code and a file name");
    auto* realm = static_cast<JSContext*>(JS_GetOpaque2(ctx, argv[0], realm_class_id));
    if (realm == nullptr) return JS_EXCEPTION;
    if (!JS_IsObject(argv[1])) return JS_ThrowTypeError(ctx, "the sandbox must be an object");
    std::size_t size = 0;
    const char* code = JS_ToCStringLen(ctx, &size, argv[2]);
    const std::string filename = text_of(ctx, argv[3]);
    if (code == nullptr) return JS_EXCEPTION;

    Scoped global(realm, JS_GetGlobalObject(realm));
    copy_enumerable(ctx, argv[1], realm, global.get());
    JSValue result = JS_Eval(realm, code, size, filename.c_str(), JS_EVAL_TYPE_GLOBAL);
    JS_FreeCString(ctx, code);
    JSValue thrown = JS_UNDEFINED;
    if (JS_IsException(result)) thrown = JS_GetException(realm);
    copy_enumerable(realm, global.get(), ctx, argv[1]);
    if (JS_IsException(result)) return JS_Throw(ctx, thrown);
    return result;
}

JSValue get_async_frame(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_GetAsyncFrame(ctx);
}

JSValue set_async_frame(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    JS_SetAsyncFrame(ctx, argc > 0 ? argv[0] : JS_NULL);
    return JS_UNDEFINED;
}

struct Export {
    const char* name;
    JSCFunction* function;
    int length;
};

constexpr Export exports[] = {
    {"spawnSync", spawn_sync, 3},
    {"zstdDecompress", zstd_decompress, 1},
    {"brotliDecompress", brotli_decompress, 1},
    {"vmCreateContext", create_realm, 0},
    {"vmRunInContext", run_in_realm, 4},
};

}

void install(JSContext* ctx, JSValueConst core, SpawnSync spawn) {
    host_spawn = spawn;
    JSRuntime* runtime = JS_GetRuntime(ctx);
    if (!JS_IsRegisteredClass(runtime, realm_class_id)) {
        JS_NewClassID(runtime, &realm_class_id);
        JSClassDef definition{};
        definition.class_name = "GmRealm";
        definition.finalizer = finalize_realm;
        JS_NewClass(runtime, realm_class_id, &definition);
    }
    JS_SetAsyncFrame(ctx, JS_NULL);
    const JSAtom frame_atom = JS_NewAtom(ctx, "asyncFrame");
    JS_DefinePropertyGetSet(ctx, core, frame_atom, JS_NewCFunction(ctx, get_async_frame, "asyncFrame", 0), JS_NewCFunction(ctx, set_async_frame, "asyncFrame", 1), JS_PROP_CONFIGURABLE | JS_PROP_ENUMERABLE);
    JS_FreeAtom(ctx, frame_atom);
    for (const Export& entry : exports) {
        if (spawn == nullptr && std::string_view(entry.name) == "spawnSync") continue;
        JS_DefinePropertyValueStr(ctx, core, entry.name, JS_NewCFunction(ctx, entry.function, entry.name, entry.length), JS_PROP_C_W_E);
    }
}

}
