#include <filesystem>
#include <iostream>
#include <memory>
#include <mutex>
#include <random>
#include <set>
#include <string>
#include <vector>

#include "gmnew/json.hpp"
#include "gmnew/mcp.hpp"
#include "gmnew/verbs.hpp"

namespace fs = std::filesystem;
using gmnew::json::Value;

namespace {

int checks = 0;
int failures = 0;
std::set<std::string> keywords_seen;

void check(bool ok, const std::string& what) {
    ++checks;
    std::cout << (ok ? "ok   " : "FAIL ") << what << std::endl;
    if (!ok) ++failures;
}

const std::set<std::string> kValidation = {"type", "properties", "required", "items", "enum"};
const std::set<std::string> kAnnotation = {"description", "title"};

std::string kind_name(const Value& v) {
    if (v.is_null()) return "null";
    if (v.is_bool()) return "boolean";
    if (v.is_number()) return "number";
    if (v.is_string()) return "string";
    if (v.is_array()) return "array";
    return "object";
}

bool known_type(const std::string& t) {
    return t == "string" || t == "number" || t == "boolean" || t == "object" || t == "array" || t == "null";
}

void keyword_errors(const Value& schema, const std::string& at, std::vector<std::string>& errors) {
    if (!schema.is_object()) {
        errors.push_back(at + ": schema is not an object");
        return;
    }
    for (const auto& member : schema.as_object()) {
        keywords_seen.insert(member.first);
        if (kValidation.contains(member.first) || kAnnotation.contains(member.first)) continue;
        errors.push_back(at + ": unsupported schema keyword \"" + member.first + "\"");
    }
    if (const Value* type = schema.find("type"); type && (!type->is_string() || !known_type(type->as_string())))
        errors.push_back(at + ": unsupported type");
    if (const Value* props = schema.find("properties"); props && props->is_object())
        for (const auto& member : props->as_object()) keyword_errors(member.second, at + "." + member.first, errors);
    if (const Value* items = schema.find("items")) keyword_errors(*items, at + "[]", errors);
}

void validate(const Value& schema, const Value& instance, const std::string& at, std::vector<std::string>& errors) {
    if (const Value* type = schema.find("type"); type && type->is_string() && type->as_string() != kind_name(instance)) {
        errors.push_back(at + ": expected " + type->as_string() + ", got " + kind_name(instance));
        return;
    }
    if (const Value* en = schema.find("enum"); en && en->is_array()) {
        bool hit = false;
        for (const Value& candidate : en->as_array()) hit = hit || candidate == instance;
        if (!hit) errors.push_back(at + ": value is not in enum");
    }
    if (const Value* req = schema.find("required"); req && req->is_array()) {
        for (const Value& name : req->as_array()) {
            if (!name.is_string()) continue;
            if (!instance.is_object() || !instance.find(name.as_string()))
                errors.push_back(at + ": missing required \"" + name.as_string() + "\"");
        }
    }
    if (const Value* props = schema.find("properties"); props && props->is_object() && instance.is_object()) {
        for (const auto& member : props->as_object())
            if (const Value* value = instance.find(member.first)) validate(member.second, *value, at + "." + member.first, errors);
    }
    if (const Value* items = schema.find("items"); items && instance.is_array()) {
        int index = 0;
        for (const Value& item : instance.as_array()) validate(*items, item, at + "[" + std::to_string(index++) + "]", errors);
    }
}

std::vector<std::string> conforms(const Value& schema, const Value& instance) {
    std::vector<std::string> errors;
    validate(schema, instance, "$", errors);
    return errors;
}

std::string rpc(int id, const std::string& method, const std::string& params) {
    return R"({"jsonrpc":"2.0","id":)" + std::to_string(id) + R"(,"method":")" + method + R"(","params":)" + params + "}";
}

std::string tool_call(int id, const std::string& tool, const std::string& args) {
    return rpc(id, "tools/call", R"({"name":")" + tool + R"(","arguments":)" + args + "}");
}

const char* kInitialize = R"({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}})";

class FakeVerbs : public gmnew::VerbTable {
public:
    std::vector<gmnew::VerbInfo> list() const override {
        return {{"read_file", "Read a file.", R"({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]})"}};
    }
    Value call(std::string_view, const Value&) override { return Value(gmnew::json::Object{}).set("ok", false); }
};

class Harness {
public:
    Harness(gmnew::VerbTable& verbs, gmnew::mcp::ServerOptions options) {
        auto opened = gmnew::mcp::Server::open(verbs, std::move(options), [this](std::string_view line) {
            auto parsed = gmnew::json::parse(line);
            std::lock_guard guard(lock_);
            if (parsed) replies_.push_back(*parsed);
        });
        if (opened) server_ = std::move(*opened);
    }

    bool ready() const { return server_ != nullptr; }
    void send(const std::string& line) { server_->accept(line); }

    Value reply(int id) {
        std::lock_guard guard(lock_);
        for (const Value& r : replies_) {
            const Value* rid = r.find("id");
            if (rid && rid->is_number() && rid->as_number() == id) return r;
        }
        return Value();
    }

    Value member_of_result(int id, const char* key) {
        Value r = reply(id);
        const Value* res = r.find("result");
        if (!res) return Value();
        const Value* found = res->find(key);
        return found ? *found : Value();
    }

private:
    std::unique_ptr<gmnew::mcp::Server> server_;
    std::vector<Value> replies_;
    std::mutex lock_;
};

gmnew::mcp::ServerOptions fresh_options(const fs::path& root) {
    gmnew::mcp::ServerOptions options;
    options.workspace = root / "ws";
    options.runs = root / "runs";
    options.skills = fs::path(GMNEW_SOURCE_DIR) / "skills";
    options.run_body = [](gmnew::VerbTable&, std::string_view body, const fs::path&, std::string_view) -> deoxidene::Result<Value, std::string> {
        return Value(gmnew::json::Object{}).set("echo", std::string(body));
    };
    fs::create_directories(options.workspace);
    fs::create_directories(options.runs);
    return options;
}

Value without_member(const Value& object, const std::string& key) {
    gmnew::json::Object kept;
    for (const auto& member : object.as_object())
        if (member.first != key) kept.push_back(member);
    return Value(kept);
}

void self_tests() {
    Value items_schema = Value(gmnew::json::Object{}).set("type", "array").set("items", Value(gmnew::json::Object{}).set("type", "string"));
    check(conforms(items_schema, Value(gmnew::json::Array{Value("a")})).empty(), "items: an array of strings conforms");
    check(!conforms(items_schema, Value(gmnew::json::Array{Value("a"), Value(1)})).empty(), "items: a number in an array of strings is rejected");
    Value enum_schema = Value(gmnew::json::Object{}).set("enum", Value(gmnew::json::Array{Value("esm"), Value("cjs")}));
    check(conforms(enum_schema, Value("esm")).empty(), "enum: a listed value conforms");
    check(!conforms(enum_schema, Value("mjs")).empty(), "enum: an unlisted value is rejected");
    Value pattern_schema = Value(gmnew::json::Object{}).set("type", "string").set("pattern", "^a");
    std::vector<std::string> keyword_problems;
    keyword_errors(pattern_schema, "$", keyword_problems);
    check(!keyword_problems.empty(), "an unsupported keyword (pattern) is flagged, not ignored");
}

int run(const fs::path& root) {
    FakeVerbs verbs;
    Harness h(verbs, fresh_options(root));
    if (!h.ready()) {
        std::cout << "FAIL server did not open" << std::endl;
        return 1;
    }
    h.send(rpc(1, "initialize", kInitialize));
    h.send(R"({"jsonrpc":"2.0","method":"notifications/initialized"})");
    h.send(rpc(2, "tools/list", "{}"));

    const Value tools = h.member_of_result(2, "tools");
    const std::vector<std::string> declared = {"next_context", "run_code", "finish"};
    check(tools.is_array() && tools.as_array().size() == declared.size(),
          "tools/list serves exactly the code tools this test validates");
    std::vector<Value> output_schemas;
    for (const std::string& name : declared) {
        const Value* tool = nullptr;
        if (tools.is_array())
            for (const Value& t : tools.as_array())
                if (t.find("name") && t.find("name")->as_string() == name) tool = &t;
        check(tool != nullptr, "tools/list declares " + name);
        if (!tool) {
            output_schemas.push_back(Value());
            continue;
        }
        const Value* out = tool->find("outputSchema");
        check(out && out->is_object(), name + " declares an outputSchema object");
        std::vector<std::string> problems;
        if (out) keyword_errors(*out, name + ".outputSchema", problems);
        if (const Value* in = tool->find("inputSchema")) keyword_errors(*in, name + ".inputSchema", problems);
        for (const std::string& p : problems) std::cout << "     " << p << std::endl;
        check(problems.empty(), name + " schemas use only supported keywords");
        output_schemas.push_back(out ? *out : Value());
    }

    h.send(tool_call(3, "next_context", "{}"));
    h.send(tool_call(4, "run_code", R"({"body":"return 2"})"));
    h.send(tool_call(5, "finish", R"({"witness":"schema test witness"})"));
    h.send(tool_call(6, "next_context", R"({"child":true,"run":"no-such-run"})"));
    h.send(tool_call(7, "finish", R"({"witness":""})"));

    std::vector<Value> replies;
    for (int id = 3; id <= 5; ++id) replies.push_back(h.member_of_result(id, "structuredContent"));
    for (std::size_t i = 0; i < declared.size(); ++i) {
        const std::string& name = declared[i];
        check(replies[i].is_object(), name + " reply carries structuredContent");
        const auto errors = conforms(output_schemas[i], replies[i]);
        for (const std::string& e : errors) std::cout << "     " << e << std::endl;
        check(errors.empty(), name + " structuredContent conforms to its outputSchema");
    }

    const std::vector<std::pair<int, std::size_t>> refusals = {{6, 0}, {7, 2}};
    for (const auto& [id, index] : refusals) {
        const Value refusal = h.member_of_result(id, "structuredContent");
        check(refusal.is_object(), declared[index] + " refusal carries structuredContent");
        const auto errors = conforms(output_schemas[index], refusal);
        for (const std::string& e : errors) std::cout << "     " << e << std::endl;
        check(errors.empty(), declared[index] + " refusal structuredContent conforms to its outputSchema");
    }

    Value flipped = replies[1];
    flipped.set("ok", Value("yes"));
    check(!conforms(output_schemas[1], flipped).empty(), "negative: a wrong-typed ok in the run_code reply is rejected");

    bool named = false;
    for (const std::string& e : conforms(output_schemas[0], without_member(replies[0], "ok")))
        named = named || e.find("missing required \"ok\"") != std::string::npos;
    check(named, "negative: a next_context reply without ok is rejected with missing required ok");

    Value stepped = replies[0];
    stepped.set("stepsLeft", Value("many"));
    check(!conforms(output_schemas[0], stepped).empty(), "negative: a non-numeric stepsLeft is rejected");

    self_tests();

    std::string covered;
    for (const std::string& k : kValidation)
        if (keywords_seen.contains(k)) covered += (covered.empty() ? "" : ", ") + k;
    std::cout << "keywords exercised: " << covered << std::endl;
    std::cout << "schema checks: " << checks << ", failed: " << failures << std::endl;
    return failures == 0 ? 0 : 1;
}

}

int main() {
    fs::path root = fs::temp_directory_path() / ("gmnew-mcp-schema-" + std::to_string(std::random_device{}()));
    fs::create_directories(root);
    const int code = run(root);
    std::error_code ignored;
    fs::remove_all(root, ignored);
    return code;
}
