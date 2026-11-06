#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "deoxidene/result.hpp"
#include "gm/host.hpp"
#include "gm/json.hpp"
#include "gm/verbs.hpp"
#include "quickjs.h"

namespace gm {
struct ConsoleBuffer;
}

namespace gm::engine {

using Clock = std::chrono::steady_clock;

struct Session {
    VerbTable* gm_verbs = nullptr;
    std::vector<VerbInfo> gm_verb_list;
    const HostServices* host = nullptr;
    gm::ConsoleBuffer* console = nullptr;
    Clock::time_point deadline = Clock::time_point::max();
    std::chrono::milliseconds deadline_budget{0};
    bool deadline_passed = false;
    std::atomic<bool>* cancel = nullptr;
    bool cancelled = false;
    std::chrono::milliseconds js_budget{0};
    Clock::time_point started = Clock::now();
    Clock::duration paused{0};
    Clock::time_point host_start{};
    int host_depth = 0;
};

class HostPause {
public:
    explicit HostPause(Session& session) : session_(session) {
        if (session_.host_depth++ == 0) session_.host_start = Clock::now();
    }
    ~HostPause() {
        if (--session_.host_depth == 0) {
            session_.paused += Clock::now() - session_.host_start;
            session_.host_start = {};
        }
    }
    HostPause(const HostPause&) = delete;
    HostPause& operator=(const HostPause&) = delete;

private:
    Session& session_;
};

class Engine {
public:
    explicit Engine(Session& session);
    ~Engine();
    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;

    bool ready() const { return context_ != nullptr; }
    JSContext* ctx() const { return context_; }
    JSRuntime* rt() const { return runtime_; }
    Session& session() const { return session_; }
    void drain_jobs();

private:
    Session& session_;
    JSRuntime* runtime_ = nullptr;
    JSContext* context_ = nullptr;
};

class Scoped {
public:
    Scoped(JSContext* ctx, JSValue value) : ctx_(ctx), value_(value) {}
    Scoped(const Scoped&) = delete;
    Scoped& operator=(const Scoped&) = delete;
    ~Scoped() { JS_FreeValue(ctx_, value_); }
    JSValueConst get() const { return value_; }
    JSValue take() {
        JSValue taken = value_;
        value_ = JS_UNDEFINED;
        return taken;
    }

private:
    JSContext* ctx_;
    JSValue value_;
};

std::string to_std_string(JSContext* ctx, JSValueConst value);
JSValue json_to_js(JSContext* ctx, const json::Value& value);
deoxidene::Result<json::Value, std::string> js_to_json(JSContext* ctx, JSValueConst value);
json::Value failed_reply(std::string error);

std::string error_text(JSContext* ctx, JSValueConst thrown);
std::string error_message(JSContext* ctx, JSValueConst thrown);
std::string take_exception_text(Engine& engine);
std::string take_exception_message(Engine& engine);

bool install_host(Engine& engine);

enum class Outcome { Fulfilled, Rejected, Pending };

struct Settled {
    Outcome outcome;
    JSValue value;
};

Settled settle(Engine& engine, JSValue maybe_promise);
std::string deadline_or(Engine& engine, std::string text);

deoxidene::Result<std::string, std::string> stringify_function_of(std::string_view parameter, std::string_view source,
                                                                  const json::Value& argument, std::chrono::milliseconds deadline);

deoxidene::Result<std::vector<std::uint8_t>, std::string> compile_module(std::string_view source, const std::string& module_name);
deoxidene::Result<JSValue, std::string> module_namespace(Engine& engine, JSValue module);
deoxidene::Result<JSValue, std::string> load_module_namespace(Engine& engine, const std::vector<std::uint8_t>& bytecode);

}
