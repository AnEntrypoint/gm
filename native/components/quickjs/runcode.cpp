#include "gmnew/runcode.hpp"

#include <exception>
#include <string>
#include <vector>

#include "engine.hpp"

namespace gmnew {
namespace {

using engine::Engine;
using engine::Scoped;
using engine::Session;

json::Value args_from_js(JSContext* ctx, int argc, JSValueConst* argv) {
    if (argc < 1 || JS_IsUndefined(argv[0])) return json::Value(json::Object{});
    auto converted = engine::js_to_json(ctx, argv[0]);
    if (!converted || converted->is_null()) return json::Value(json::Object{});
    return std::move(*converted);
}

JSValue resolved_promise(JSContext* ctx, JSValue value) {
    JSValue resolving[2];
    JSValue promise = JS_NewPromiseCapability(ctx, resolving);
    if (JS_IsException(promise)) {
        JS_FreeValue(ctx, value);
        return promise;
    }
    JSValue settled = JS_Call(ctx, resolving[0], JS_UNDEFINED, 1, &value);
    JS_FreeValue(ctx, settled);
    JS_FreeValue(ctx, value);
    JS_FreeValue(ctx, resolving[0]);
    JS_FreeValue(ctx, resolving[1]);
    return promise;
}

JSValue call_verb(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv, int verb_index, JSValueConst*) {
    auto* session = static_cast<Session*>(JS_GetContextOpaque(ctx));
    const std::string& name = session->gm_verb_list[static_cast<size_t>(verb_index)].name;
    json::Value reply;
    try {
        reply = session->gm_verbs->call(name, args_from_js(ctx, argc, argv));
    } catch (const std::exception& err) {
        reply = engine::failed_reply(err.what());
    } catch (...) {
        reply = engine::failed_reply("the verb failed");
    }
    JSValue reply_js = engine::json_to_js(ctx, reply);
    if (JS_IsException(reply_js)) return reply_js;
    return resolved_promise(ctx, reply_js);
}

std::string verbs_json(const std::vector<VerbInfo>& verb_list) {
    json::Value list(json::Array{});
    for (const auto& verb : verb_list) {
        json::Value entry;
        entry.set("name", verb.name);
        entry.set("description", verb.description);
        auto schema = json::parse(verb.input_schema_json.empty() ? std::string_view("{}") : verb.input_schema_json);
        entry.set("inputSchema", schema ? std::move(*schema) : json::Value(json::Object{}));
        list.push(std::move(entry));
    }
    return json::dump(list);
}

constexpr std::string_view gm_bootstrap = R"JS((function (gm, verbsText) {
  gm.verbs = () => JSON.parse(verbsText);
  gm.try = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}))JS";

deoxidene::Result<JSValue, std::string> make_gm(Engine& engine, const std::filesystem::path& project_root) {
    JSContext* ctx = engine.ctx();
    const auto& verb_list = engine.session().gm_verb_list;
    Scoped gm(ctx, JS_NewObject(ctx));
    for (size_t index = 0; index < verb_list.size(); ++index) {
        JSValue fn = JS_NewCFunctionData(ctx, call_verb, 1, static_cast<int>(index), 0, nullptr);
        JS_DefinePropertyValueStr(ctx, gm.get(), verb_list[index].name.c_str(), fn, JS_PROP_C_W_E);
    }
    std::string project = project_root.string();
    JS_SetPropertyStr(ctx, gm.get(), "project", JS_NewStringLen(ctx, project.data(), project.size()));
    Scoped install(ctx, JS_Eval(ctx, gm_bootstrap.data(), gm_bootstrap.size(), "<gm>", JS_EVAL_TYPE_GLOBAL));
    if (JS_IsException(install.get())) return deoxidene::Err<std::string>(engine::take_exception_text(engine));
    std::string verbs_text = verbs_json(verb_list);
    JSValue install_args[2] = {gm.get(), JS_NewStringLen(ctx, verbs_text.data(), verbs_text.size())};
    Scoped installed(ctx, JS_Call(ctx, install.get(), JS_UNDEFINED, 2, install_args));
    JS_FreeValue(ctx, install_args[1]);
    if (JS_IsException(installed.get())) return deoxidene::Err<std::string>(engine::take_exception_text(engine));
    return gm.take();
}

}  // namespace

deoxidene::Result<json::Value, std::string> run_body(VerbTable& verbs, std::string_view body,
                                                     const std::filesystem::path& project_root) {
    using Fail = deoxidene::Err<std::string>;
    if (body.find_first_not_of(" \t\r\n") == std::string_view::npos) return Fail("body must be a non-empty string");

    Session session;
    session.gm_verbs = &verbs;
    session.gm_verb_list = verbs.list();
    Engine engine(session);
    if (!engine.ready()) return Fail("the JavaScript runtime did not start");
    JSContext* ctx = engine.ctx();

    auto gm = make_gm(engine, project_root);
    if (!gm) return Fail(gm.error());
    Scoped gm_value(ctx, *gm);

    std::string source = "(async function body(gm) {\n";
    source.append(body);
    source.append("\n})");
    Scoped function(ctx, JS_Eval(ctx, source.c_str(), source.size(), "<body>", JS_EVAL_TYPE_GLOBAL));
    if (JS_IsException(function.get())) return Fail("the body does not load: " + engine::take_exception_text(engine));

    JSValue call_args[1] = {gm_value.get()};
    engine::Settled settled = engine::settle(engine, JS_Call(ctx, function.get(), JS_UNDEFINED, 1, call_args));
    Scoped value(ctx, settled.value);
    if (settled.outcome == engine::Outcome::Rejected) return Fail(engine::deadline_or(engine, engine::error_text(ctx, value.get())));
    if (settled.outcome == engine::Outcome::Pending) return Fail("the body stopped before it returned");

    auto converted = engine::js_to_json(ctx, value.get());
    if (!converted) return Fail(converted.error());
    return std::move(*converted);
}

}  // namespace gmnew
