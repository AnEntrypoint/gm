#include "engine.hpp"

#include <cstring>
#include <exception>
#include <fstream>
#include <iterator>

namespace gm::engine {
namespace {

int interrupt_on_deadline(JSContext*, void* opaque) {
    auto* session = static_cast<Session*>(opaque);
    const auto now = Clock::now();
    if (session->cancel != nullptr && session->cancel->load(std::memory_order_relaxed)) {
        session->cancelled = true;
        return 1;
    }
    if (session->js_budget.count() > 0) {
        Clock::duration paused = session->paused;
        if (session->host_depth > 0) paused += now - session->host_start;
        if (now - session->started - paused >= session->js_budget) {
            session->deadline_passed = true;
            return 1;
        }
    }
    if (session->deadline == Clock::time_point::max() || now < session->deadline) return 0;
    session->deadline_passed = true;
    return 1;
}

bool read_text_file(const std::string& path, std::string& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    out.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    return true;
}

JSModuleDef* load_module_from_disk(JSContext* ctx, const char* module_name, void*) {
    std::string source;
    if (!read_text_file(module_name, source)) {
        JS_ThrowReferenceError(ctx, "could not load module '%s'", module_name);
        return nullptr;
    }
    JSValue compiled = JS_Eval(ctx, source.c_str(), source.size(), module_name, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(compiled)) return nullptr;
    auto* module = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiled));
    JS_FreeValue(ctx, compiled);
    return module;
}

JSValue throw_text(JSContext* ctx, const std::string& text) {
    return JS_ThrowInternalError(ctx, "%s", text.c_str());
}

JSValue call_host(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    auto* session = static_cast<Session*>(JS_GetContextOpaque(ctx));
    if (session == nullptr || session->host == nullptr) return throw_text(ctx, "host services are not available here");
    std::string name = argc > 0 ? to_std_string(ctx, argv[0]) : std::string();
    json::Value args(json::Object{});
    if (argc > 1 && !JS_IsUndefined(argv[1])) {
        auto converted = js_to_json(ctx, argv[1]);
        if (!converted) return throw_text(ctx, "host." + name + " needs a JSON object: " + converted.error());
        if (!converted->is_null()) args = std::move(*converted);
    }
    json::Value reply;
    try {
        HostPause paused(*session);
        if (auto extra = session->host->extra.find(name); extra != session->host->extra.end()) {
            reply = extra->second(args);
        } else if (session->host->native != nullptr) {
            reply = session->host->native->call(name, args);
        } else {
            return throw_text(ctx, "host has no verb " + name);
        }
    } catch (const std::exception& err) {
        return throw_text(ctx, "host." + name + " failed: " + err.what());
    } catch (...) {
        return throw_text(ctx, "host." + name + " failed");
    }
    return json_to_js(ctx, reply);
}

JSValue host_names(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    auto* session = static_cast<Session*>(JS_GetContextOpaque(ctx));
    json::Value names(json::Array{});
    if (session == nullptr || session->host == nullptr) return json_to_js(ctx, names);
    for (const auto& [name, primitive] : session->host->extra) names.push(name);
    if (session->host->native != nullptr) {
        try {
            for (const auto& verb : session->host->native->list()) names.push(verb.name);
        } catch (const std::exception& err) {
            return throw_text(ctx, std::string("the host verb list failed: ") + err.what());
        } catch (...) {
            return throw_text(ctx, "the host verb list failed");
        }
    }
    return json_to_js(ctx, names);
}

constexpr std::string_view host_bootstrap = R"JS((function (callHost, hostNames, workspace, runDir) {
  const data = { workspace, runDir };
  let functions = null;
  const known = () => {
    if (functions === null) {
      functions = new Map();
      for (const name of hostNames()) {
        if (!Object.hasOwn(data, name) && !functions.has(name)) functions.set(name, (args) => callHost(name, args));
      }
    }
    return functions;
  };
  const has = (name) => typeof name === 'string' && (Object.hasOwn(data, name) || known().has(name));
  return new Proxy({}, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (Object.hasOwn(data, name)) return data[name];
      return known().get(name);
    },
    has(target, name) {
      return has(name);
    },
    ownKeys() {
      return [...Object.keys(data), ...known().keys()];
    },
    getOwnPropertyDescriptor(target, name) {
      if (!has(name)) return undefined;
      const value = Object.hasOwn(data, name) ? data[name] : known().get(name);
      return { value, writable: false, enumerable: true, configurable: true };
    },
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
  });
}))JS";

constexpr std::string_view stringify_bootstrap = R"JS((function (parameter, source, argument) {
  let evaluate;
  try {
    evaluate = new Function(parameter, `return (${source});`);
  } catch {
    evaluate = new Function(parameter, source);
  }
  return JSON.stringify(evaluate(argument)) ?? 'undefined';
}))JS";

}

Engine::Engine(Session& session) : session_(session) {
    runtime_ = JS_NewRuntime();
    if (runtime_ == nullptr) return;
    JS_SetInterruptHandler(runtime_, interrupt_on_deadline, &session_);
    JS_SetModuleLoaderFunc(runtime_, nullptr, load_module_from_disk, nullptr);
    context_ = JS_NewContext(runtime_);
    if (context_ != nullptr) JS_SetContextOpaque(context_, &session_);
}

Engine::~Engine() {
    if (context_ != nullptr) JS_FreeContext(context_);
    if (runtime_ != nullptr) JS_FreeRuntime(runtime_);
}

void Engine::drain_jobs() {
    JSContext* job_ctx = nullptr;
    while (JS_ExecutePendingJob(runtime_, &job_ctx) > 0) {
    }
}

std::string to_std_string(JSContext* ctx, JSValueConst value) {
    size_t length = 0;
    const char* text = JS_ToCStringLen(ctx, &length, value);
    if (text == nullptr) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        return {};
    }
    std::string out(text, length);
    JS_FreeCString(ctx, text);
    return out;
}

JSValue json_to_js(JSContext* ctx, const json::Value& value) {
    std::string text = json::dump(value);
    return JS_ParseJSON(ctx, text.c_str(), text.size(), "<json>");
}

deoxidene::Result<json::Value, std::string> js_to_json(JSContext* ctx, JSValueConst value) {
    Scoped text(ctx, JS_JSONStringify(ctx, value, JS_UNDEFINED, JS_UNDEFINED));
    if (JS_IsException(text.get())) {
        Scoped thrown(ctx, JS_GetException(ctx));
        return deoxidene::Err<std::string>(error_message(ctx, thrown.get()));
    }
    if (JS_IsUndefined(text.get())) return json::Value(nullptr);
    auto parsed = json::parse(to_std_string(ctx, text.get()));
    if (!parsed) return deoxidene::Err<std::string>("the value is not JSON: " + parsed.error());
    return std::move(*parsed);
}

json::Value failed_reply(std::string error) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", std::move(error));
    return reply;
}

std::string error_message(JSContext* ctx, JSValueConst thrown) {
    if (!JS_IsError(thrown)) return to_std_string(ctx, thrown);
    Scoped message(ctx, JS_GetPropertyStr(ctx, thrown, "message"));
    return to_std_string(ctx, message.get());
}

std::string error_text(JSContext* ctx, JSValueConst thrown) {
    std::string text = error_message(ctx, thrown);
    if (!JS_IsError(thrown)) return text;
    Scoped stack(ctx, JS_GetPropertyStr(ctx, thrown, "stack"));
    if (!JS_IsString(stack.get())) return text;
    std::string stack_text = to_std_string(ctx, stack.get());
    auto line_start = stack_text.find_first_not_of(" \n");
    if (line_start == std::string::npos) return text;
    auto line_end = stack_text.find('\n', line_start);
    std::string first_line = stack_text.substr(line_start, line_end == std::string::npos ? std::string::npos : line_end - line_start);
    return text + "\n    " + first_line;
}

std::string deadline_or(Engine& engine, std::string text) {
    const Session& session = engine.session();
    if (session.cancelled) return "the body was stopped";
    if (!session.deadline_passed) return text;
    if (session.js_budget.count() > 0) {
        return "the body passed its JavaScript deadline of " + std::to_string(session.js_budget.count()) + " ms";
    }
    return "the call passed its deadline of " + std::to_string(session.deadline_budget.count()) + " ms";
}

std::string take_exception_text(Engine& engine) {
    Scoped thrown(engine.ctx(), JS_GetException(engine.ctx()));
    return deadline_or(engine, error_text(engine.ctx(), thrown.get()));
}

std::string take_exception_message(Engine& engine) {
    Scoped thrown(engine.ctx(), JS_GetException(engine.ctx()));
    return deadline_or(engine, error_message(engine.ctx(), thrown.get()));
}

bool install_host(Engine& engine) {
    JSContext* ctx = engine.ctx();
    Scoped factory(ctx, JS_Eval(ctx, host_bootstrap.data(), host_bootstrap.size(), "<host>", JS_EVAL_TYPE_GLOBAL));
    if (JS_IsException(factory.get())) return false;
    Scoped native_call(ctx, JS_NewCFunction(ctx, call_host, "callHost", 2));
    const HostServices* services = engine.session().host;
    std::string workspace = services != nullptr ? services->workspace.generic_string() : std::string();
    std::string run_dir = services != nullptr ? services->run_dir.generic_string() : std::string();
    Scoped workspace_js(ctx, JS_NewStringLen(ctx, workspace.data(), workspace.size()));
    Scoped run_dir_js(ctx, JS_NewStringLen(ctx, run_dir.data(), run_dir.size()));
    Scoped names_call(ctx, JS_NewCFunction(ctx, host_names, "hostNames", 0));
    JSValue factory_args[4] = {native_call.get(), names_call.get(), workspace_js.get(), run_dir_js.get()};
    JSValue host = JS_Call(ctx, factory.get(), JS_UNDEFINED, 4, factory_args);
    if (JS_IsException(host)) return false;
    Scoped global(ctx, JS_GetGlobalObject(ctx));
    return JS_SetPropertyStr(ctx, global.get(), "host", host) >= 0;
}

Settled settle(Engine& engine, JSValue maybe_promise) {
    JSContext* ctx = engine.ctx();
    if (JS_IsException(maybe_promise)) return {Outcome::Rejected, JS_GetException(ctx)};
    if (!JS_IsPromise(maybe_promise)) return {Outcome::Fulfilled, maybe_promise};
    Scoped promise(ctx, maybe_promise);
    engine.drain_jobs();
    switch (JS_PromiseState(ctx, promise.get())) {
        case JS_PROMISE_FULFILLED:
            return {Outcome::Fulfilled, JS_PromiseResult(ctx, promise.get())};
        case JS_PROMISE_REJECTED:
            return {Outcome::Rejected, JS_PromiseResult(ctx, promise.get())};
        default:
            if (JS_HasException(ctx)) return {Outcome::Rejected, JS_GetException(ctx)};
            return {Outcome::Pending, JS_UNDEFINED};
    }
}

deoxidene::Result<std::string, std::string> stringify_function_of(std::string_view parameter, std::string_view source,
                                                                  const json::Value& argument, std::chrono::milliseconds deadline) {
    Session session;
    session.deadline_budget = deadline;
    session.deadline = Clock::now() + deadline;
    Engine engine(session);
    if (!engine.ready()) return deoxidene::Err<std::string>("the JavaScript runtime did not start");
    JSContext* ctx = engine.ctx();
    Scoped factory(ctx, JS_Eval(ctx, stringify_bootstrap.data(), stringify_bootstrap.size(), "<stringify>", JS_EVAL_TYPE_GLOBAL));
    if (JS_IsException(factory.get())) return deoxidene::Err<std::string>(take_exception_message(engine));
    Scoped parameter_js(ctx, JS_NewStringLen(ctx, parameter.data(), parameter.size()));
    Scoped source_js(ctx, JS_NewStringLen(ctx, source.data(), source.size()));
    Scoped argument_js(ctx, json_to_js(ctx, argument));
    if (JS_IsException(argument_js.get())) return deoxidene::Err<std::string>(take_exception_message(engine));
    JSValue call_args[3] = {parameter_js.get(), source_js.get(), argument_js.get()};
    Scoped text(ctx, JS_Call(ctx, factory.get(), JS_UNDEFINED, 3, call_args));
    if (JS_IsException(text.get())) return deoxidene::Err<std::string>(take_exception_message(engine));
    return to_std_string(ctx, text.get());
}

deoxidene::Result<std::vector<std::uint8_t>, std::string> compile_module(std::string_view source, const std::string& module_name) {
    Session session;
    Engine engine(session);
    if (!engine.ready()) return deoxidene::Err<std::string>("the JavaScript runtime did not start");
    std::string text(source);
    Scoped compiled(engine.ctx(), JS_Eval(engine.ctx(), text.c_str(), text.size(), module_name.c_str(),
                                          JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY));
    if (JS_IsException(compiled.get())) return deoxidene::Err<std::string>(take_exception_text(engine));
    size_t size = 0;
    std::uint8_t* bytes = JS_WriteObject(engine.ctx(), &size, compiled.get(), JS_WRITE_OBJ_BYTECODE);
    if (bytes == nullptr) return deoxidene::Err<std::string>(take_exception_text(engine));
    std::vector<std::uint8_t> out(bytes, bytes + size);
    js_free(engine.ctx(), bytes);
    return out;
}

deoxidene::Result<JSValue, std::string> module_namespace(Engine& engine, JSValue module) {
    JSContext* ctx = engine.ctx();
    if (JS_ResolveModule(ctx, module) < 0) {
        JS_FreeValue(ctx, module);
        return deoxidene::Err<std::string>(take_exception_message(engine));
    }
    auto* definition = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(module));
    Settled evaluated = settle(engine, JS_EvalFunction(ctx, module));
    Scoped evaluated_value(ctx, evaluated.value);
    if (evaluated.outcome == Outcome::Rejected) return deoxidene::Err<std::string>(deadline_or(engine, error_message(ctx, evaluated.value)));
    if (evaluated.outcome == Outcome::Pending) return deoxidene::Err<std::string>("the module did not finish loading");
    return JS_GetModuleNamespace(ctx, definition);
}

deoxidene::Result<JSValue, std::string> load_module_namespace(Engine& engine, const std::vector<std::uint8_t>& bytecode) {
    JSContext* ctx = engine.ctx();
    JSValue module = JS_ReadObject(ctx, bytecode.data(), bytecode.size(), JS_READ_OBJ_BYTECODE);
    if (JS_IsException(module)) return deoxidene::Err<std::string>(take_exception_message(engine));
    return module_namespace(engine, module);
}

}
