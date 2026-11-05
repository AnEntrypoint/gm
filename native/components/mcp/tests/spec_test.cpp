#include <filesystem>
#include <iostream>
#include <memory>
#include <mutex>
#include <random>
#include <string>
#include <vector>

#include "gm/json.hpp"
#include <atomic>
#include <chrono>
#include <thread>

#include "gm/mcp.hpp"
#include "gm/verbs.hpp"

namespace fs = std::filesystem;
using gm::json::Value;

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << std::endl;
    if (!ok) ++failures;
}

class FakeVerbs : public gm::VerbTable {
public:
    std::vector<gm::VerbInfo> list() const override {
        return {{"read_file", "Read a file.", R"({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]})"}};
    }
    Value call(std::string_view, const Value&) override { return Value(gm::json::Object{}).set("ok", false); }
};

class GrowingVerbs : public FakeVerbs {
public:
    std::atomic<bool> grown{false};
    std::vector<gm::VerbInfo> list() const override {
        auto all = FakeVerbs::list();
        if (grown) all.push_back({"extra_verb", "An added verb.", R"({"type":"object"})"});
        return all;
    }
};

std::string rpc(int id, const std::string& method, const std::string& params) {
    return R"({"jsonrpc":"2.0","id":)" + std::to_string(id) + R"(,"method":")" + method + R"(","params":)" + params + "}";
}

std::string str(const Value& v, const char* key) {
    const Value* f = v.find(key);
    return f && f->is_string() ? f->as_string() : "";
}

double ttl_of(const Value& v) {
    const Value* f = v.find("ttlMs");
    return f && f->is_number() ? f->as_number() : -1.0;
}

struct Harness {
    std::unique_ptr<gm::mcp::Server> server;
    std::vector<Value> out;
    std::mutex lock;

    Harness(gm::VerbTable& verbs, gm::mcp::ServerOptions options) {
        auto opened = gm::mcp::Server::open(verbs, std::move(options), [this](std::string_view line) {
            auto parsed = gm::json::parse(line);
            std::lock_guard guard(lock);
            if (parsed) out.push_back(*parsed);
        });
        if (opened) server = std::move(*opened);
        else std::cout << "open failed: " << opened.error() << '\n';
    }

    Value raw(int id) {
        std::lock_guard guard(lock);
        for (const Value& r : out) {
            const Value* rid = r.find("id");
            if (rid && rid->is_number() && rid->as_number() == id) return r;
        }
        return Value();
    }

    Value result(int id) {
        Value reply = raw(id);
        const Value* r = reply.find("result");
        return r ? *r : Value();
    }

    Value error(int id) {
        Value reply = raw(id);
        const Value* e = reply.find("error");
        return e ? *e : Value();
    }

    void call_next_context() { server->accept(rpc(198, "tools/call", R"({"name":"next_context","arguments":{}})")); }

    int methods(const std::string& method) {
        std::lock_guard guard(lock);
        int n = 0;
        for (const Value& v : out) n += str(v, "method") == method ? 1 : 0;
        return n;
    }
};

gm::mcp::ServerOptions fresh_options(const fs::path& root) {
    gm::mcp::ServerOptions options;
    options.workspace = root / "ws";
    options.runs = root / "runs";
    options.skills = fs::path(GMNEW_SOURCE_DIR) / "skills";
    fs::create_directories(options.workspace);
    fs::create_directories(options.runs);
    return options;
}

fs::path scratch(const std::string& section) {
    return fs::temp_directory_path() / ("gm-mcp-spec-" + section + "-" + std::to_string(std::random_device{}()));
}

const char* kInitialize = R"({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}})";

void discover() {
    fs::path root = scratch("discover");
    FakeVerbs verbs;
    Harness h(verbs, fresh_options(root));
    h.server->accept(rpc(199, "initialize", kInitialize));
    h.server->accept(rpc(200, "server/discover", "{}"));
    Value d = h.result(200);
    const Value* versions = d.find("supportedVersions");
    bool versions_ok = versions && versions->is_array() && versions->as_array().size() == 2 &&
                       versions->as_array()[0].as_string() == "2025-11-25" && versions->as_array()[1].as_string() == "2025-06-18";
    check(str(d, "resultType") == "complete" && versions_ok, "server/discover answers a complete result with the served versions");
    const Value* caps = d.find("capabilities");
    check(caps && caps->find("tools") && caps->find("prompts") && caps->find("resources") && caps->find("logging") &&
              caps->find("completions") && caps->find("extensions"),
          "discover declares the capabilities the server serves");
    check(caps && caps->find("resources") && !caps->find("resources")->find("subscribe"),
          "discover declares no resources.subscribe, since subscriptions/listen replaces resources/subscribe");
    const Value* meta = d.find("_meta");
    const Value* server_info = meta ? meta->find("io.modelcontextprotocol/serverInfo") : nullptr;
    check(server_info && str(*server_info, "name") == "gm" && !str(*server_info, "version").empty(),
          "discover carries _meta serverInfo with name and version");
    check(!str(d, "instructions").empty() && str(d, "instructions") == str(h.result(199), "instructions"),
          "discover instructions match initialize");
    check(ttl_of(d) == 3600000 && str(d, "cacheScope") == "public", "discover carries ttlMs and cacheScope public");
    fs::remove_all(root);
}

void caching() {
    fs::path root = scratch("caching");
    FakeVerbs verbs;
    Harness h(verbs, fresh_options(root));
    h.call_next_context();
    std::string run_id = h.server->run_dir().filename().string();
    h.server->accept(rpc(201, "tools/list", "{}"));
    h.server->accept(rpc(202, "prompts/list", "{}"));
    h.server->accept(rpc(203, "resources/list", "{}"));
    h.server->accept(rpc(204, "resources/templates/list", "{}"));
    h.server->accept(rpc(205, "resources/read", R"({"uri":"skill://gm/SKILL.md"})"));
    h.server->accept(rpc(209, "resources/read", "{\"uri\":\"run://" + run_id + "/log\"}"));
    check(ttl_of(h.result(201)) == 3600000 && str(h.result(201), "cacheScope") == "public", "tools/list carries ttlMs and cacheScope");
    check(ttl_of(h.result(202)) == 3600000 && str(h.result(202), "cacheScope") == "public", "prompts/list carries ttlMs and cacheScope");
    check(ttl_of(h.result(203)) == 0 && str(h.result(203), "cacheScope") == "public", "resources/list carries ttlMs 0 and cacheScope");
    check(ttl_of(h.result(204)) == 3600000 && str(h.result(204), "cacheScope") == "public", "resources/templates/list carries ttlMs and cacheScope");
    check(ttl_of(h.result(205)) == 3600000 && str(h.result(205), "cacheScope") == "public", "resources/read of a skill file carries ttlMs and cacheScope");
    check(ttl_of(h.result(209)) == 0 && str(h.result(209), "cacheScope") == "public", "resources/read of a run log carries ttlMs 0 and cacheScope");
    fs::remove_all(root);
}

void missing() {
    fs::path root = scratch("missing");
    FakeVerbs verbs;
    Harness h(verbs, fresh_options(root));
    h.server->accept(rpc(206, "resources/read", R"({"uri":"skill://gm/NOPE.md"})"));
    h.server->accept(rpc(207, "resources/read", "{}"));
    h.server->accept(rpc(208, "subscriptions/listen", R"({"notifications":{"resourceSubscriptions":["skill://gm/NOPE.md"]}})"));
    Value e206 = h.error(206);
    const Value* data = e206.find("data");
    check(e206.find("code") && e206.find("code")->as_number() == -32602 && data && str(*data, "uri") == "skill://gm/NOPE.md" &&
              h.result(206).find("contents") == nullptr,
          "a missing resource is -32602 with data.uri and no contents");
    check(h.error(207).find("code") && h.error(207).find("code")->as_number() == -32602, "resources/read without a uri is -32602");
    check(h.error(208).find("code") && h.error(208).find("code")->as_number() == -32602, "subscriptions/listen of a missing resource is -32602");
    check(h.methods("notifications/subscriptions/acknowledged") == 0, "a refused subscriptions/listen is not acknowledged");
    fs::remove_all(root);
}

void annotations() {
    fs::path root = scratch("annotations");
    FakeVerbs verbs;
    Harness h(verbs, fresh_options(root));
    h.server->accept(rpc(201, "tools/list", "{}"));
    Value tools_result = h.result(201);
    const Value* tools = tools_result.find("tools");
    bool titles_schemas = tools && tools->is_array() && tools->as_array().size() == 3;
    bool next_ok = false;
    bool finish_ok = false;
    bool run_ok = false;
    if (titles_schemas) {
        for (const Value& tool : tools->as_array()) {
            const Value* a = tool.find("annotations");
            const Value* schema = tool.find("inputSchema");
            if (!a || str(tool, "title").empty() || !schema || str(*schema, "type") != "object") titles_schemas = false;
            if (!a) continue;
            const Value* ro = a->find("readOnlyHint");
            const Value* de = a->find("destructiveHint");
            const Value* ow = a->find("openWorldHint");
            if (!ro || !de || !ow) continue;
            if (str(tool, "name") == "next_context") next_ok = ro->as_bool() && !de->as_bool();
            if (str(tool, "name") == "finish") finish_ok = !ro->as_bool() && !de->as_bool() && !ow->as_bool();
            if (str(tool, "name") == "run_code") run_ok = !ro->as_bool() && de->as_bool() && ow->as_bool();
        }
    }
    check(titles_schemas, "every tool has a title and an object inputSchema");
    check(next_ok, "next_context is readOnlyHint true and destructiveHint false");
    check(finish_ok, "finish is destructiveHint false");
    check(run_ok, "run_code is openWorldHint true and destructiveHint true");
    fs::remove_all(root);
}

void capabilities() {
    fs::path root = scratch("capabilities");
    FakeVerbs verbs;
    Harness h(verbs, fresh_options(root));
    h.server->accept(rpc(199, "initialize", kInitialize));
    h.server->accept(rpc(210, "logging/setLevel", R"({"level":"info"})"));
    h.server->accept(rpc(211, "completion/complete", R"({"ref":{"type":"ref/resource","uri":"skill://{name}/SKILL.md"},"argument":{"name":"name","value":"gm"}})"));
    h.server->accept(rpc(212, "resources/subscribe", R"({"uri":"skill://gm/SKILL.md"})"));
    h.server->accept(rpc(213, "skills/list", "{}"));
    Value init = h.result(199);
    const Value* caps = init.find("capabilities");
    check(caps && caps->find("resources") && !caps->find("resources")->find("subscribe"),
          "initialize declares no resources.subscribe, since subscriptions/listen replaces resources/subscribe");
    Value log_reply = h.raw(210);
    check(log_reply.find("result") != nullptr && log_reply.find("error") == nullptr, "logging/setLevel answers, as declared");
    check(h.result(211).find("completion") != nullptr, "completion/complete answers, as declared");
    check(h.error(212).find("code") && h.error(212).find("code")->as_number() == -32601,
          "resources/subscribe is replaced by subscriptions/listen, so it answers method not found");
    check(h.result(213).find("skills") != nullptr, "skills/list answers for the declared skills extension");
    fs::remove_all(root);
}

void list_changed_pushed_on_ready() {
    fs::path root = scratch("list-ready");
    GrowingVerbs growing;
    Harness h(growing, fresh_options(root));
    h.server->accept(rpc(310, "tools/list", "{}"));
    check(h.result(310).find("tools") != nullptr, "a tools/list before readiness answers without waiting");
    check(h.methods("notifications/tools/list_changed") == 0, "no tools list_changed before the server is ready");
    growing.grown = true;
    bool pushed = false;
    for (int i = 0; i < 250 && !pushed; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
        pushed = h.methods("notifications/tools/list_changed") == 1;
    }
    check(pushed, "readiness pushes notifications/tools/list_changed without another message");
    fs::remove_all(root);
}

void list_changed() {
    list_changed_pushed_on_ready();
    fs::path root = scratch("list-changed");
    GrowingVerbs growing;
    Harness h(growing, fresh_options(root));
    h.server->accept(rpc(300, "tools/list", "{}"));
    check(h.methods("notifications/tools/list_changed") == 0, "no tools list_changed before the list changes");
    growing.grown = true;
    h.server->accept(rpc(301, "tools/list", "{}"));
    check(h.methods("notifications/tools/list_changed") == 1, "a changed tool list sends notifications/tools/list_changed once");
    check(h.methods("notifications/prompts/list_changed") == 0, "an unchanged prompt list sends no prompts list_changed");
    h.server->accept(rpc(302, "tools/list", "{}"));
    check(h.methods("notifications/tools/list_changed") == 1, "the change is announced once");
    fs::remove_all(root);
}

}

int main(int argc, char** argv) {
    std::string section = argc > 1 ? argv[1] : "";
    if (section == "discover") discover();
    else if (section == "caching") caching();
    else if (section == "missing") missing();
    else if (section == "annotations") annotations();
    else if (section == "capabilities") capabilities();
    else if (section == "list_changed") list_changed();
    else {
        std::cout << "usage: gm_mcp_spec_test discover|caching|missing|annotations|capabilities|list_changed\n";
        return 2;
    }
    std::cout << (failures == 0 ? "ALL PASSED" : "FAILURES: " + std::to_string(failures)) << '\n';
    return failures == 0 ? 0 : 1;
}
