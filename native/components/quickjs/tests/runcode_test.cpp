#include <cstdio>
#include <string>
#include <vector>

#include "gmnew/json.hpp"
#include "gmnew/runcode.hpp"

namespace {

int failures = 0;

void expect(bool condition, const std::string& what) {
    if (condition) return;
    ++failures;
    std::fprintf(stderr, "FAIL: %s\n", what.c_str());
}

class FakeVerbs : public gmnew::VerbTable {
public:
    std::vector<std::string> calls;

    std::vector<gmnew::VerbInfo> list() const override {
        return {
            {"echo", "Returns its arguments.", R"({"type":"object","properties":{"text":{"type":"string"}}})"},
            {"add", "Adds a and b.", R"({"type":"object","required":["a","b"]})"},
            {"broken", "Always fails.", "{}"},
        };
    }

    gmnew::json::Value call(std::string_view name, const gmnew::json::Value& args) override {
        calls.emplace_back(name);
        gmnew::json::Value reply;
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

gmnew::json::Value run_ok(FakeVerbs& verbs, std::string_view body, const std::string& what) {
    auto result = gmnew::run_body(verbs, body, project_root);
    expect(result.has_value(), what + ": expected a value, got error " + (result ? std::string() : result.error()));
    return result ? *result : gmnew::json::Value();
}

void test_promise_all_over_two_verbs() {
    FakeVerbs verbs;
    auto value = run_ok(verbs,
                        "const [e, s] = await Promise.all([gm.echo({ text: 'hi' }), gm.add({ a: 2, b: 3 })]);\n"
                        "return { text: e.args.text, sum: s.sum };",
                        "promise all");
    expect(gmnew::json::dump(value) == R"({"text":"hi","sum":5})", "promise all value: " + gmnew::json::dump(value));
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
    expect(gmnew::json::dump(value) ==
               R"({"reply":{"ok":false,"error":"broken on purpose"},"thrown":{"ok":false,"error":"broken on purpose"},"fine":2})",
           "gm.try value: " + gmnew::json::dump(value));
}

void test_nested_return() {
    FakeVerbs verbs;
    auto value = run_ok(verbs, "return { a: [1, 2.5, { b: null, c: 'x\\n' }], d: { e: { f: true } }, g: undefined };", "nested");
    expect(gmnew::json::dump(value) == R"({"a":[1,2.5,{"b":null,"c":"x\n"}],"d":{"e":{"f":true}}})", "nested value: " + gmnew::json::dump(value));
}

void test_throw_in_body() {
    FakeVerbs verbs;
    auto result = gmnew::run_body(verbs, "await gm.echo({});\nthrow new Error('boom here');", project_root);
    expect(!result.has_value(), "throw gives an error");
    if (!result) {
        expect(result.error().rfind("boom here", 0) == 0, "throw message first: " + result.error());
        expect(result.error().find("at ") != std::string::npos, "throw names a stack line: " + result.error());
    }
    auto sync_throw = gmnew::run_body(verbs, "throw 'plain';", project_root);
    expect(!sync_throw && sync_throw.error() == "plain", "a thrown string is its text");
    auto syntax = gmnew::run_body(verbs, "return {;", project_root);
    expect(!syntax && syntax.error().rfind("the body does not load: ", 0) == 0, "syntax error names the load");
}

void test_top_level_await_and_gm_fields() {
    FakeVerbs verbs;
    auto value = run_ok(verbs,
                        "const x = await new Promise((resolve) => resolve(41));\n"
                        "const list = gm.verbs();\n"
                        "list[0].name = 'mutated';\n"
                        "return { x: x + 1, project: gm.project, names: gm.verbs().map((v) => v.name), schema: list[1].inputSchema };",
                        "top-level await");
    expect(gmnew::json::dump(value) ==
               R"({"x":42,"project":"/project/root","names":["echo","add","broken"],"schema":{"type":"object","required":["a","b"]}})",
           "top-level await value: " + gmnew::json::dump(value));
}

void test_fresh_state_and_edges() {
    FakeVerbs verbs;
    run_ok(verbs, "globalThis.leak = 1; return null;", "leak set");
    auto value = run_ok(verbs, "return typeof globalThis.leak;", "leak read");
    expect(gmnew::json::dump(value) == R"("undefined")", "each body has fresh state");
    auto nothing = run_ok(verbs, "await gm.echo();", "no return");
    expect(nothing.is_null(), "no return value is null");
    auto stuck = gmnew::run_body(verbs, "await new Promise(() => {});", project_root);
    expect(!stuck && stuck.error() == "the body stopped before it returned", "a body that never settles is an error");
    auto empty = gmnew::run_body(verbs, "  \n", project_root);
    expect(!empty && empty.error() == "body must be a non-empty string", "empty body refused");
}

}

int main() {
    test_promise_all_over_two_verbs();
    test_try_catches_failing_verb();
    test_nested_return();
    test_throw_in_body();
    test_top_level_await_and_gm_fields();
    test_fresh_state_and_edges();
    if (failures == 0) std::printf("runcode: all tests passed\n");
    return failures == 0 ? 0 : 1;
}
