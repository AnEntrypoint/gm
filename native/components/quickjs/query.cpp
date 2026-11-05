#include "gm/query.hpp"

#include "engine.hpp"

namespace gm {
namespace {

constexpr std::string_view query_runner = R"JS((function (eventsText, js) {
  const cap = 20000;
  try {
    const events = JSON.parse(eventsText);
    let filter;
    try {
      filter = new Function('events', `return (${js});`);
    } catch {
      filter = new Function('events', js);
    }
    const text = JSON.stringify(filter(events)) ?? 'undefined';
    const output = text.length <= cap ? text : `${text.slice(0, cap)} ...[cut at ${cap} chars, narrow the filter]`;
    return JSON.stringify({ ok: true, output });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}))JS";

}

deoxidene::Result<std::string, std::string> run_query(std::string_view events_json_array, std::string_view js) {
    using Fail = deoxidene::Err<std::string>;
    engine::Session session;
    engine::Engine engine(session);
    if (!engine.ready()) return Fail("the JavaScript runtime did not start");
    JSContext* ctx = engine.ctx();
    engine::Scoped runner(ctx, JS_Eval(ctx, query_runner.data(), query_runner.size(), "<query>", JS_EVAL_TYPE_GLOBAL));
    if (JS_IsException(runner.get())) return Fail(engine::take_exception_text(engine));
    JSValue call_args[2] = {JS_NewStringLen(ctx, events_json_array.data(), events_json_array.size()),
                            JS_NewStringLen(ctx, js.data(), js.size())};
    engine::Scoped reply(ctx, JS_Call(ctx, runner.get(), JS_UNDEFINED, 2, call_args));
    JS_FreeValue(ctx, call_args[0]);
    JS_FreeValue(ctx, call_args[1]);
    if (JS_IsException(reply.get())) return Fail(engine::take_exception_text(engine));
    auto parsed = json::parse(engine::to_std_string(ctx, reply.get()));
    if (!parsed) return Fail(parsed.error());
    const json::Value* ok = parsed->find("ok");
    if (ok != nullptr && ok->as_bool()) return parsed->find("output")->as_string();
    const json::Value* error = parsed->find("error");
    return Fail(error != nullptr && error->is_string() ? error->as_string() : "undefined");
}

}
