#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <future>
#include <memory>
#include <random>
#include <string>
#include <thread>
#include <vector>

#include "gm/json.hpp"
#include "gm/runcode.hpp"

namespace {

int failures = 0;

void expect(bool condition, const std::string& what) {
    if (condition) return;
    ++failures;
    std::fprintf(stderr, "FAIL: %s\n", what.c_str());
}

class FakeVerbs : public gm::VerbTable {
public:
    std::vector<std::string> calls;

    std::vector<gm::VerbInfo> list() const override {
        return {
            {"echo", "Returns its arguments.", R"({"type":"object","properties":{"text":{"type":"string"}}})"},
            {"add", "Adds a and b.", R"({"type":"object","required":["a","b"]})"},
            {"broken", "Always fails.", "{}"},
        };
    }

    gm::json::Value call(std::string_view name, const gm::json::Value& args) override {
        calls.emplace_back(name);
        const gm::json::Value* wait = args.find("waitMs");
        if (wait != nullptr && wait->is_number()) std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<long long>(wait->as_number())));
        gm::json::Value reply;
        if (name == "echo") {
            reply.set("ok", true);
            reply.set("args", args);
        } else if (name == "add") {
            const auto* a = args.find("a");
            const auto* b = args.find("b");
            reply.set("ok", true);
            reply.set("sum", (a ? a->as_number() : 0) + (b ? b->as_number() : 0));
        } else {
            reply.set("ok", false);
            reply.set("error", "broken on purpose");
        }
        return reply;
    }
};

const std::filesystem::path project_root = "/project/root";

void test_js_deadline_stops_spin() {
    FakeVerbs verbs;
    auto controls = std::make_shared<gm::BodyControls>();
    controls->js_budget = std::chrono::milliseconds(100);
    const auto start = std::chrono::steady_clock::now();
    auto result = gm::run_body(verbs, "while (true) {}", project_root, "cjs", controls);
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
    expect(!result && result.error() == "the body passed its JavaScript deadline of 100 ms",
           "a spinning body is stopped by its JavaScript deadline: " + (result ? "a value" : result.error()));
    expect(elapsed < 5000, "the JavaScript deadline stops the spin promptly: " + std::to_string(elapsed) + " ms");
}

void test_cancel_stops_spin() {
    auto controls = std::make_shared<gm::BodyControls>();
    auto outcome = std::make_shared<std::promise<std::string>>();
    auto future = outcome->get_future();
    std::thread worker([verbs = FakeVerbs{}, controls, outcome]() mutable {
        auto result = gm::run_body(verbs, "while (true) {}", project_root, "cjs", controls);
        outcome->set_value(result ? gm::json::dump(*result) : result.error());
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    controls->stopped = true;
    const bool exited = future.wait_for(std::chrono::seconds(5)) == std::future_status::ready;
    if (exited) worker.join();
    else worker.detach();
    expect(exited, "a cancelled spinning body exits its thread");
    if (exited) {
        const std::string error = future.get();
        expect(error == "the body was stopped", "a cancelled body reports the stop: " + error);
    }
}

void test_long_verb_does_not_spend_js_deadline() {
    FakeVerbs verbs;
    auto controls = std::make_shared<gm::BodyControls>();
    controls->js_budget = std::chrono::milliseconds(100);
    auto result = gm::run_body(verbs, "const r = await gm.echo({ waitMs: 400 }); return r.ok;", project_root, "cjs", controls);
    expect(result && gm::json::dump(*result) == "true",
           "a body awaiting a long verb still returns: " + (result ? gm::json::dump(*result) : result.error()));
}

gm::json::Value run_ok(FakeVerbs& verbs, std::string_view body, const std::string& what) {
    auto result = gm::run_body(verbs, body, project_root);
    expect(result.has_value(), what + ": expected a value, got error " + (result ? std::string() : result.error()));
    return result ? *result : gm::json::Value();
}

void test_promise_all_over_two_verbs() {
    FakeVerbs verbs;
    auto value = run_ok(verbs,
                        "const [e, s] = await Promise.all([gm.echo({ text: 'hi' }), gm.add({ a: 2, b: 3 })]);\n"
                        "return { text: e.args.text, sum: s.sum };",
                        "promise all");
    expect(gm::json::dump(value) == R"({"text":"hi","sum":5})", "promise all value: " + gm::json::dump(value));
    expect(verbs.calls.size() == 2, "promise all made two calls");
}

void test_try_catches_failing_verb() {
    FakeVerbs verbs;
    auto value = run_ok(verbs,
                        "const reply = await gm.try(() => gm.broken({}));\n"
                        "const thrown = await gm.try(async () => { const r = await gm.broken({}); throw new Error(r.error); });\n"
                        "const fine = await gm.try(() => gm.add({ a: 1, b: 1 }));\n"
                        "return { reply, thrown, fine: fine.sum };",
                        "gm.try");
    expect(gm::json::dump(value) ==
               R"({"reply":{"ok":false,"error":"broken on purpose"},"thrown":{"ok":false,"error":"broken on purpose"},"fine":2})",
           "gm.try value: " + gm::json::dump(value));
}

void test_nested_return() {
    FakeVerbs verbs;
    auto value = run_ok(verbs, "return { a: [1, 2.5, { b: null, c: 'x\\n' }], d: { e: { f: true } }, g: undefined };", "nested");
    expect(gm::json::dump(value) == R"({"a":[1,2.5,{"b":null,"c":"x\n"}],"d":{"e":{"f":true}}})", "nested value: " + gm::json::dump(value));
}

void test_throw_in_body() {
    FakeVerbs verbs;
    auto result = gm::run_body(verbs, "await gm.echo({});\nthrow new Error('boom here');", project_root);
    expect(!result.has_value(), "throw gives an error");
    if (!result) {
        expect(result.error().rfind("boom here", 0) == 0, "throw message first: " + result.error());
        expect(result.error().find("at ") != std::string::npos, "throw names a stack line: " + result.error());
    }
    auto sync_throw = gm::run_body(verbs, "throw 'plain';", project_root);
    expect(!sync_throw && sync_throw.error() == "plain", "a thrown string is its text");
    auto syntax = gm::run_body(verbs, "return {;", project_root);
    expect(!syntax && syntax.error().rfind("the body does not load: ", 0) == 0, "syntax error names the load");
    expect(!syntax && syntax.error().find(" (line 1, column 9)") != std::string::npos, "syntax error gives its line and column: " + syntax.error());
}

void test_top_level_await_and_gm_fields() {
    FakeVerbs verbs;
    auto value = run_ok(verbs,
                        "const x = await new Promise((resolve) => resolve(41));\n"
                        "const list = gm.verbs();\n"
                        "list[0].name = 'mutated';\n"
                        "return { x: x + 1, project: gm.project, names: gm.verbs().map((v) => v.name), schema: list[1].inputSchema };",
                        "top-level await");
    expect(gm::json::dump(value) ==
               R"({"x":42,"project":"/project/root","names":["echo","add","broken"],"schema":{"type":"object","required":["a","b"]}})",
           "top-level await value: " + gm::json::dump(value));
}

void test_verbs_filter() {
    FakeVerbs verbs;
    auto value = run_ok(verbs,
                        "const all = gm.verbs();\n"
                        "const one = gm.verbs({ name: 'add' });\n"
                        "const names = gm.verbs({ names: true });\n"
                        "return { all: all.length, full: all.every((v) => typeof v.description === 'string' && v.inputSchema !== null && typeof v.inputSchema === 'object'), one, names };",
                        "verbs filter");
    expect(gm::json::dump(value) ==
               R"({"all":3,"full":true,"one":{"name":"add","description":"Adds a and b.","inputSchema":{"type":"object","required":["a","b"]}},"names":["echo","add","broken"]})",
           "verbs filter value: " + gm::json::dump(value));
    auto unknown = gm::run_body(verbs, "return gm.verbs({ name: 'nope' });", project_root);
    expect(!unknown && unknown.error().rfind("unknown verb: nope", 0) == 0,
           "unknown verb name is reported: " + (unknown ? std::string() : unknown.error()));
    auto bad_shape = gm::run_body(verbs, "return gm.verbs({ names: false });", project_root);
    expect(!bad_shape && bad_shape.error().find("gm.verbs() takes") != std::string::npos,
           "a bad filter shape is refused: " + (bad_shape ? std::string() : bad_shape.error()));
}

void test_fresh_state_and_edges() {
    FakeVerbs verbs;
    run_ok(verbs, "globalThis.leak = 1; return null;", "leak set");
    auto value = run_ok(verbs, "return typeof globalThis.leak;", "leak read");
    expect(gm::json::dump(value) == R"("undefined")", "each body has fresh state");
    auto nothing = run_ok(verbs, "await gm.echo();", "no return");
    expect(nothing.is_null(), "no return value is null");
    auto stuck = gm::run_body(verbs, "await new Promise(() => {});", project_root);
    expect(!stuck && stuck.error() == "the body stopped before it returned", "a body that never settles is an error");
    auto empty = gm::run_body(verbs, "  \n", project_root);
    expect(!empty && empty.error() == "body must be a non-empty string", "empty body refused");
}

std::filesystem::path fresh_project(const std::string& package_json = "") {
    std::filesystem::path root = std::filesystem::temp_directory_path() / ("gm-runcode-" + std::to_string(std::random_device{}()));
    std::filesystem::create_directories(root);
    std::ofstream(root / "lib.mjs") << "export const value = 41;\n";
    if (!package_json.empty()) std::ofstream(root / "package.json") << package_json;
    return root;
}

void test_esm_static_import_returns_value() {
    FakeVerbs verbs;
    const std::filesystem::path project = fresh_project();
    auto result = gm::run_body(verbs,
                                  "import { value } from './lib.mjs';\n"
                                  "const sum = await gm.add({ a: value, b: 1 });\n"
                                  "return { value: value + 1, sum: sum.sum };",
                                  project, "esm");
    expect(result.has_value(), "esm static import: expected a value, got error " + (result ? std::string() : result.error()));
    if (result) expect(gm::json::dump(*result) == R"({"value":42,"sum":42})", "esm static import value: " + gm::json::dump(*result));
    std::filesystem::remove_all(project);
}

void test_cjs_format_is_the_default() {
    FakeVerbs verbs;
    auto named = gm::run_body(verbs, "return { n: 1 };", project_root, "cjs");
    auto defaulted = gm::run_body(verbs, "return { n: 1 };", project_root);
    expect(named.has_value() && defaulted.has_value(), "cjs format runs with and without the format argument");
    if (named && defaulted) expect(gm::json::dump(*named) == R"({"n":1})" && gm::json::dump(*defaulted) == R"({"n":1})", "cjs format returns its value");
}

void test_default_format_follows_package_type() {
    FakeVerbs verbs;
    const std::filesystem::path module_project = fresh_project("{\"type\":\"module\"}\n");
    const std::filesystem::path script_project = fresh_project("{\"type\":\"commonjs\"}\n");
    const std::filesystem::path bare_project = fresh_project();
    auto esm = gm::run_body(verbs, "import { value } from './lib.mjs';\nreturn value + 1;", module_project, "");
    expect(esm.has_value(), "type module default runs as esm: " + (esm ? std::string() : esm.error()));
    if (esm) expect(gm::json::dump(*esm) == "42", "type module default value: " + gm::json::dump(*esm));
    auto script = gm::run_body(verbs, "return { n: 1 };", script_project, "");
    expect(script.has_value() && gm::json::dump(*script) == R"({"n":1})", "type commonjs default runs as cjs");
    auto bare = gm::run_body(verbs, "return { n: 1 };", bare_project, "");
    expect(bare.has_value(), "no package.json default runs as cjs");
    auto refused = gm::run_body(verbs, "import { value } from './lib.mjs';\nreturn value;", script_project, "");
    expect(!refused && refused.error() == "refused: a CommonJS body cannot use a static import; use format esm", "cjs static import is refused: " + (refused ? std::string() : refused.error()));
    std::filesystem::remove_all(module_project);
    std::filesystem::remove_all(script_project);
    std::filesystem::remove_all(bare_project);
}

void test_esm_syntax_error_reports_position() {
    FakeVerbs verbs;
    auto result = gm::run_body(verbs, "const x = ;\nreturn x;", project_root, "esm");
    expect(!result, "esm syntax error is an error");
    if (!result) {
        expect(result.error().rfind("the body does not load: ", 0) == 0, "esm syntax error is a load error: " + result.error());
        expect(result.error().find(" (line 1, column 11)") != std::string::npos, "esm syntax error gives its line and column: " + result.error());
    }
}

}

int main() {
    test_promise_all_over_two_verbs();
    test_esm_static_import_returns_value();
    test_cjs_format_is_the_default();
    test_default_format_follows_package_type();
    test_esm_syntax_error_reports_position();
    test_try_catches_failing_verb();
    test_nested_return();
    test_throw_in_body();
    test_top_level_await_and_gm_fields();
    test_verbs_filter();
    test_fresh_state_and_edges();
    test_js_deadline_stops_spin();
    test_cancel_stops_spin();
    test_long_verb_does_not_spend_js_deadline();
    if (failures == 0) std::printf("runcode: all tests passed\n");
    return failures == 0 ? 0 : 1;
}
