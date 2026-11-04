#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "engine.hpp"
#include "gmnew/json.hpp"
#include "gmnew/leaves.hpp"
#include "gmnew/runcode.hpp"

namespace {

namespace fs = std::filesystem;
using gmnew::json::dump;

int failures = 0;

void expect(bool condition, const std::string& what) {
    if (condition) return;
    ++failures;
    std::fprintf(stderr, "FAIL: %s\n", what.c_str());
}

class FakeNative : public gmnew::VerbTable {
public:
    std::vector<std::string> calls;
    std::vector<gmnew::VerbInfo> list() const override { return {{"read_file", "Reads a file.", "{}"}}; }
    gmnew::json::Value call(std::string_view name, const gmnew::json::Value& args) override {
        calls.emplace_back(name);
        gmnew::json::Value reply;
        if (name != "read_file") {
            reply.set("ok", false);
            reply.set("error", "unknown verb: " + std::string(name));
            return reply;
        }
        const auto* path = args.find("path");
        reply.set("ok", true);
        reply.set("content", "content of " + (path ? path->as_string() : std::string("?")));
        return reply;
    }
};

void write_text(const fs::path& file, const std::string& text, fs::file_time_type mtime) {
    std::ofstream(file, std::ios::binary | std::ios::trunc) << text;
    fs::last_write_time(file, mtime);
}

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

void replace_all(std::string& text, const std::string& from, const std::string& to) {
    for (auto at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size())) text.replace(at, from.size(), to);
}

void test_leaves(const fs::path& fixtures) {
    fs::path dir = fs::temp_directory_path() / ("gmnew-leaves-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    fs::create_directories(dir);
    fs::copy_file(fixtures / "sample.mjs", dir / "sample.mjs");
    fs::copy_file(fixtures / "helper.mjs", dir / "helper.mjs");
    std::string original = read_text(dir / "sample.mjs");
    auto base_time = fs::last_write_time(dir / "sample.mjs");

    FakeNative native;
    gmnew::HostServices host;
    host.workspace = dir;
    host.run_dir = dir / "run";
    host.native = &native;
    std::vector<std::string> logged;
    host.extra["shell"] = [](const gmnew::json::Value& args) {
        gmnew::json::Value reply;
        reply.set("ok", true);
        reply.set("output", "ran " + args.find("command")->as_string());
        return reply;
    };
    host.extra["logAppend"] = [&](const gmnew::json::Value& event) {
        logged.push_back(dump(event));
        return gmnew::json::Value(gmnew::json::Object{});
    };

    gmnew::LeafVerbs leaves(dir, host);
    auto list = leaves.list();
    expect(list.size() == 6, "six verbs listed, got " + std::to_string(list.size()));
    expect(!list.empty() && list[0].name == "sample_value" && list[0].input_schema_json == R"({"type":"object","properties":{"who":{"type":"string"}}})",
           "verb metadata read");
    auto start_generation = leaves.generation();

    auto first = leaves.call("sample_value", gmnew::json::parse(R"({"who":"leaf"})").value());
    expect(dump(first) == R"({"ok":true,"value":1,"label":"hello leaf"})", "first call: " + dump(first));

    auto hosted = leaves.call("sample_host", gmnew::json::parse(R"({"path":"a.txt"})").value());
    expect(dump(hosted) == R"({"ok":true,"content":"content of a.txt","shell":"ran echo hi"})", "host call: " + dump(hosted));
    expect(native.calls.size() == 1 && native.calls[0] == "read_file", "host.read_file reached the fake VerbTable");

    auto paths = leaves.call("sample_paths", gmnew::json::Value(gmnew::json::Object{}));
    gmnew::json::Value expected_paths;
    expected_paths.set("workspace", dir.generic_string());
    expected_paths.set("runDir", (dir / "run").generic_string());
    expected_paths.set("kinds", gmnew::json::Array{"string", "string"});
    expect(paths == expected_paths, "host paths are strings: " + dump(paths));

    auto shape = leaves.call("sample_host_shape", gmnew::json::Value(gmnew::json::Object{}));
    expect(dump(shape) ==
               R"({"missing":"undefined","deleteFile":"undefined","missingIn":false,)"
               R"("keys":["logAppend","read_file","runDir","shell","workspace"],)"
               R"("kinds":{"read_file":"function","shell":"function","logAppend":"function","workspace":"string","runDir":"string"}})",
           "host has exactly its names: " + dump(shape));

    auto thrown = leaves.call("sample_throw", gmnew::json::Value(gmnew::json::Object{}));
    expect(dump(thrown) == R"({"ok":false,"error":"leaf failed on purpose"})", "throw: " + dump(thrown));
    auto missing = leaves.call("sample_missing_host", gmnew::json::Value(gmnew::json::Object{}));
    expect(dump(missing) == R"({"ok":false,"error":"not a function"})", "missing host verb: " + dump(missing));
    auto unknown = leaves.call("nope", gmnew::json::Value(gmnew::json::Object{}));
    expect(dump(unknown) == R"({"ok":false,"error":"unknown verb: nope"})", "unknown: " + dump(unknown));

    std::string edited = original;
    replace_all(edited, "value: 1,", "value: 2,");
    write_text(dir / "sample.mjs", edited, base_time + std::chrono::seconds(2));
    auto reload_started = std::chrono::steady_clock::now();
    auto second = leaves.call("sample_value", gmnew::json::Value(gmnew::json::Object{}));
    auto reload_us = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - reload_started).count();
    expect(dump(second) == R"({"ok":true,"value":2,"label":"hello nobody"})", "edited call: " + dump(second));
    expect(leaves.generation() == start_generation + 1, "generation increased after the edit");

    std::string broken = edited;
    replace_all(broken, "value: 2,", "value: 3,,,");
    write_text(dir / "sample.mjs", broken, base_time + std::chrono::seconds(4));
    auto refused = leaves.call("sample_value", gmnew::json::Value(gmnew::json::Object{}));
    expect(!refused.find("ok")->as_bool(true) && refused.find("error")->as_string().find("does not load, so its last good code is kept") != std::string::npos,
           "syntax error reported: " + dump(refused));
    expect(leaves.generation() == start_generation + 1, "a failed compile does not bump the generation");
    expect(logged.size() == 1 && logged[0].find("leaf-refused") != std::string::npos, "the refusal is logged");
    auto kept = leaves.call("sample_value", gmnew::json::Value(gmnew::json::Object{}));
    expect(dump(kept) == R"({"ok":true,"value":2,"label":"hello nobody"})", "old code kept: " + dump(kept));

    write_text(dir / "sample.mjs", original, base_time + std::chrono::seconds(6));
    auto restored = leaves.call("sample_value", gmnew::json::Value(gmnew::json::Object{}));
    expect(dump(restored) == R"({"ok":true,"value":1,"label":"hello nobody"})", "restored: " + dump(restored));
    expect(leaves.generation() == start_generation + 2, "generation increased after the fix");

    auto warm_started = std::chrono::steady_clock::now();
    constexpr int warm_calls = 200;
    for (int i = 0; i < warm_calls; ++i) leaves.call("sample_value", gmnew::json::Value(gmnew::json::Object{}));
    auto warm_us = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - warm_started).count() / warm_calls;
    std::printf("leaves: reload call %lld us, warm call %lld us\n", static_cast<long long>(reload_us), static_cast<long long>(warm_us));

    fs::remove_all(dir);
}

void test_deadline() {
    gmnew::engine::Session session;
    session.deadline_budget = std::chrono::milliseconds(50);
    session.deadline = gmnew::engine::Clock::now() + session.deadline_budget;
    gmnew::engine::Engine engine(session);
    std::string loop = "for (;;) {}";
    JSValue result = JS_Eval(engine.ctx(), loop.c_str(), loop.size(), "<loop>", JS_EVAL_TYPE_GLOBAL);
    expect(JS_IsException(result), "an endless loop is stopped");
    std::string error = gmnew::engine::take_exception_message(engine);
    expect(error == "the call passed its deadline of 50 ms", "deadline error: " + error);
}

}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: gmnew_leaves_test <fixtures dir>\n");
        return 2;
    }
    test_leaves(argv[1]);
    test_deadline();
    if (failures == 0) std::printf("leaves: all tests passed\n");
    return failures == 0 ? 0 : 1;
}
