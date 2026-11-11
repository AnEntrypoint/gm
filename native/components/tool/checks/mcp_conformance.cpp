#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <functional>
#include <initializer_list>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string_view>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kProtocol = "2025-06-18";
const std::vector<std::string> kServedVersions{"2025-11-25", "2025-06-18"};
const std::vector<std::string> kCapabilities{"tools", "prompts", "resources", "logging", "completions"};
const std::vector<std::string> kLogLevels{"debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"};
const std::vector<std::string> kCodeTools{"next_context", "run_code", "finish"};
constexpr const char* kSkillUri = "skill://gm/SKILL.md";
constexpr const char* kWorkflowUri = "skill://gm/WORKFLOWS.md";
constexpr const char* kMissingUri = "skill://gm/NOPE.md";
constexpr double kHourMs = 3600000;
constexpr std::chrono::milliseconds kRequestTimeout{60000};
constexpr double kInvalidParams = -32602;
constexpr double kMethodNotFound = -32601;
constexpr double kResourceNotFound = -32002;
constexpr const char* kStepWarning =
    "stepsLeft is 0: the next next_context call ends this run without a witness. To close it with a witness, call finish now, while stepsLeft is 0.";
constexpr const char* kStepRefusal =
    "refused: step limit 50 reached and this run ended without a witness; call next_context to open a successor run. To close a run with a witness, call finish while stepsLeft is 0, before the next next_context call";

const json::Value* at(const json::Value* value, std::initializer_list<std::string_view> keys) {
    for (std::string_view key : keys) {
        if (value == nullptr) return nullptr;
        value = value->find(key);
    }
    return value;
}

const json::Value* first(const json::Value* value) {
    if (value == nullptr || !value->is_array() || value->as_array().empty()) return nullptr;
    return &value->as_array().front();
}

bool non_empty(const json::Value* value) { return value != nullptr && value->is_string() && !value->as_string().empty(); }

bool is_true(const json::Value* value) { return value != nullptr && value->is_bool() && value->as_bool(); }

bool is_false(const json::Value* value) { return value != nullptr && value->is_bool() && !value->as_bool(); }

bool is_text(const json::Value* value, std::string_view expected) { return value != nullptr && value->is_string() && value->as_string() == expected; }

bool is_number(const json::Value* value, double expected) { return value != nullptr && value->is_number() && value->as_number() == expected; }

bool truthy(const json::Value* value) {
    if (value == nullptr || value->is_null()) return false;
    if (value->is_bool()) return value->as_bool();
    if (value->is_number()) return value->as_number() != 0;
    if (value->is_string()) return !value->as_string().empty();
    return true;
}

bool empty_result(const json::Value* value) {
    if (value == nullptr || value->is_null()) return false;
    if (value->is_object()) return value->as_object().empty();
    if (value->is_array()) return value->as_array().empty();
    return value->is_string() ? value->as_string().empty() : true;
}

bool same_value(const json::Value* a, const json::Value* b) {
    if (a == nullptr || b == nullptr) return a == b;
    return *a == *b;
}

bool same_list(const json::Value* value, const std::vector<std::string>& expected) {
    if (value == nullptr || !value->is_array() || value->as_array().size() != expected.size()) return false;
    for (std::size_t i = 0; i < expected.size(); ++i)
        if (!is_text(&value->as_array()[i], expected[i])) return false;
    return true;
}

bool has_every(const json::Value* object, const std::vector<std::string>& keys) {
    return std::all_of(keys.begin(), keys.end(), [&](const std::string& key) { return object != nullptr && object->find(key) != nullptr; });
}

bool cached(const json::Value* result, double ttl) { return is_number(at(result, {"ttlMs"}), ttl) && is_text(at(result, {"cacheScope"}), "public"); }

std::string brief(const json::Value* value) {
    if (value == nullptr) return "undefined";
    return json::dump(*value).substr(0, 240);
}

std::string brief(const json::Value& value) { return brief(&value); }

std::string string_of(const json::Value* value) {
    if (value == nullptr) return "undefined";
    return value->is_string() ? value->as_string() : json::dump(*value);
}

json::Value picked(const json::Value* from, std::initializer_list<std::string_view> keys) {
    json::Value out = json::Object{};
    for (std::string_view key : keys)
        if (const json::Value* found = at(from, {key})) out.set(std::string(key), *found);
    return out;
}

bool contains(const std::string& text, std::string_view part) { return text.find(part) != std::string::npos; }

struct Box {
    std::mutex mutex;
    std::condition_variable cv;
    std::vector<json::Value> inbox;
    bool closed = false;
};

class Client {
public:
    Client(const std::vector<std::string>& argv, const fs::path& workspace, const fs::path& home) {
        proc::SpawnOptions options(workspace);
        options.own_group = true;
        options.capture_stderr = true;
        options.env = {{"HOME", home.string()}};
        auto spawned = proc::Child::spawn(argv, options);
        if (!spawned) {
            spawn_error_ = spawned.error();
            return;
        }
        child_ = *spawned;
        std::thread([child = child_] {
            while (child->read_error_chunk()) {}
        }).detach();
        std::thread([child = child_, box = box_] {
            for (;;) {
                auto line = child->read_line();
                if (!line) break;
                auto parsed = json::parse(*line);
                if (!parsed) continue;
                std::lock_guard lock(box->mutex);
                box->inbox.push_back(*parsed);
                box->cv.notify_all();
            }
            std::lock_guard lock(box->mutex);
            box->closed = true;
            box->cv.notify_all();
        }).detach();
    }

    ~Client() { close(); }
    Client(const Client&) = delete;
    Client& operator=(const Client&) = delete;

    std::int64_t next_id = 1;
    json::Value init_result = json::Object{};

    void send(const json::Value& message) {
        if (!child_ || !child_->write_line(json::dump(message))) throw std::runtime_error("the gm serve stdin is closed");
    }

    json::Value wait_for(const std::function<bool(const json::Value&)>& match, const std::string& what) {
        std::unique_lock lock(box_->mutex);
        const json::Value* found = nullptr;
        const auto search = [&] {
            for (const json::Value& message : box_->inbox)
                if (match(message)) {
                    found = &message;
                    return true;
                }
            return box_->closed;
        };
        box_->cv.wait_for(lock, kRequestTimeout, search);
        if (found == nullptr) {
            if (box_->closed) throw std::runtime_error("gm serve closed its output before " + what);
            throw std::runtime_error("no " + what + " within " + std::to_string(kRequestTimeout.count()) + " ms");
        }
        return *found;
    }

    void drop(std::int64_t id) {
        std::lock_guard lock(box_->mutex);
        std::erase_if(box_->inbox, [&](const json::Value& message) { return is_number(message.find("id"), static_cast<double>(id)); });
    }

    json::Value rpc(const std::string& method, json::Value params = json::Object{}) {
        const std::int64_t id = next_id++;
        send(json::Object{{"jsonrpc", "2.0"}, {"id", id}, {"method", method}, {"params", std::move(params)}});
        return wait_for([id](const json::Value& m) { return is_number(m.find("id"), static_cast<double>(id)); }, "answer to " + method);
    }

    void notify(const std::string& method, json::Value params = json::Object{}) {
        send(json::Object{{"jsonrpc", "2.0"}, {"method", method}, {"params", std::move(params)}});
    }

    void open() {
        if (!child_) throw std::runtime_error("gm serve did not start: " + spawn_error_);
        const json::Value init = rpc("initialize", json::Object{{"protocolVersion", kProtocol}, {"capabilities", json::Object{}},
                                                                {"clientInfo", json::Object{{"name", "gm-conformance"}, {"version", "1"}}}});
        const json::Value* result = init.find("result");
        init_result = result != nullptr ? *result : json::Object{};
        notify("notifications/initialized");
        rpc("resources/read", json::Object{{"uri", kSkillUri}});
    }

    void close() {
        if (!child_) return;
        child_->close_input();
        if (!child_->wait_for(std::chrono::milliseconds(5000))) {
            child_->terminate();
            if (!child_->wait_for(std::chrono::milliseconds(2000))) {
                child_->kill();
                child_->wait_for(std::chrono::milliseconds(2000));
            }
        }
        child_.reset();
    }

private:
    std::shared_ptr<proc::Child> child_;
    std::shared_ptr<Box> box_ = std::make_shared<Box>();
    std::string spawn_error_;
};

struct Recorder {
    int passed = 0;
    int failed = 0;
    std::string scenario;
    std::vector<std::string>* failures = nullptr;

    void operator()(const std::string& name, bool ok, const std::string& detail = {}) {
        if (ok) {
            ++passed;
            return;
        }
        ++failed;
        failures->push_back(scenario + ": " + name + (detail.empty() ? std::string() : " -- " + detail));
    }
};

struct Context {
    std::string binary;
    fs::path workspace;
    fs::path home;
    fs::path config;

    std::vector<std::string> argv(const std::vector<std::string>& extra) const {
        std::vector<std::string> out{binary, "serve", "--workspace", workspace.string(), "--mcp-config", config.string()};
        out.insert(out.end(), extra.begin(), extra.end());
        return out;
    }
};

struct Scenario {
    std::string name;
    std::vector<std::string> args;
    std::function<void(Client&, Recorder&)> run;
};

json::Value call_tool(Client& c, const std::string& name, json::Value args) {
    return c.rpc("tools/call", json::Object{{"name", name}, {"arguments", std::move(args)}});
}

json::Value structured(Client& c, const std::string& name, json::Value args) {
    const json::Value reply = call_tool(c, name, std::move(args));
    const json::Value* found = at(&reply, {"result", "structuredContent"});
    return found != nullptr ? *found : json::Object{};
}

json::Value code_output(Client& c, const std::string& body) {
    const json::Value reply = call_tool(c, "run_code", json::Object{{"body", body}});
    const json::Value* result = reply.find("result");
    const json::Value* raw = at(result, {"structuredContent", "output"});
    json::Value from_text;
    if (raw == nullptr || raw->is_null()) {
        const json::Value* text = at(first(at(result, {"content"})), {"text"});
        auto parsed = json::parse(text != nullptr && text->is_string() ? text->as_string() : std::string("{}"));
        if (!parsed) throw std::runtime_error("run_code reply text was not JSON");
        from_text = *parsed;
        raw = from_text.find("output");
    }
    if (raw == nullptr) return json::Value();
    if (raw->is_string()) {
        auto parsed = json::parse(raw->as_string());
        if (!parsed) throw std::runtime_error("run_code output was not JSON: " + raw->as_string().substr(0, 200));
        return *parsed;
    }
    return *raw;
}

const json::Value* find_named(const json::Value* list, std::string_view name) {
    if (list == nullptr || !list->is_array()) return nullptr;
    for (const json::Value& item : list->as_array())
        if (is_text(item.find("name"), name)) return &item;
    return nullptr;
}

bool error_code(const json::Value& reply, double code) { return is_number(at(&reply, {"error", "code"}), code); }

std::string tool_description(const json::Value* tools, std::string_view name) {
    const json::Value* description = at(find_named(tools, name), {"description"});
    return description != nullptr && description->is_string() ? description->as_string() : std::string();
}

std::vector<Scenario> scenarios(const Context& context, const fs::path& rules_dir, const fs::path& handoff_dir, const fs::path& step_limit_dir) {
    std::vector<Scenario> list;
    list.push_back({"server-initialize", {}, [](Client& c, Recorder& ok) {
        const json::Value* r = &c.init_result;
        const json::Value* version = at(r, {"protocolVersion"});
        ok("protocolVersion is a served version",
           version != nullptr && version->is_string() && std::find(kServedVersions.begin(), kServedVersions.end(), version->as_string()) != kServedVersions.end(), brief(version));
        ok("serverInfo has a name and a version", non_empty(at(r, {"serverInfo", "name"})) && non_empty(at(r, {"serverInfo", "version"})), brief(at(r, {"serverInfo"})));
        ok("declares tools, prompts, resources, logging and completions", has_every(at(r, {"capabilities"}), kCapabilities), brief(at(r, {"capabilities"})));
        ok("tools, prompts and resources declare listChanged",
           is_true(at(r, {"capabilities", "tools", "listChanged"})) && is_true(at(r, {"capabilities", "prompts", "listChanged"})) && is_true(at(r, {"capabilities", "resources", "listChanged"})));
        ok("resources declares subscribe", is_true(at(r, {"capabilities", "resources", "subscribe"})), brief(at(r, {"capabilities", "resources"})));
        ok("instructions are a non-empty string", non_empty(at(r, {"instructions"})));
    }});
    list.push_back({"server/discover", {}, [](Client& c, Recorder& ok) {
        const json::Value r = c.rpc("server/discover");
        const json::Value* d = r.find("result");
        ok("answers a result, not an error", d != nullptr, brief(r.find("error")));
        ok("resultType is complete", is_text(at(d, {"resultType"}), "complete"), brief(at(d, {"resultType"})));
        ok("supportedVersions lists the served versions", same_list(at(d, {"supportedVersions"}), kServedVersions), brief(at(d, {"supportedVersions"})));
        ok("declares the served capabilities", has_every(at(d, {"capabilities"}), kCapabilities), brief(at(d, {"capabilities"})));
        ok("declares resources.subscribe", is_true(at(d, {"capabilities", "resources", "subscribe"})), brief(at(d, {"capabilities", "resources"})));
        ok("carries instructions", non_empty(at(d, {"instructions"})));
        ok("carries ttlMs 3600000 and cacheScope public", is_number(at(d, {"ttlMs"}), kHourMs) && is_text(at(d, {"cacheScope"}), "public"),
           "ttlMs=" + string_of(at(d, {"ttlMs"})) + " cacheScope=" + string_of(at(d, {"cacheScope"})));
        ok("serverInfo in _meta names gm", is_text(at(d, {"_meta", "io.modelcontextprotocol/serverInfo", "name"}), "gm"), brief(at(d, {"_meta"})));
    }});
    list.push_back({"caching", {}, [](Client& c, Recorder& ok) {
        const json::Value tools = c.rpc("tools/list");
        const json::Value prompts = c.rpc("prompts/list");
        const json::Value resources = c.rpc("resources/list");
        const json::Value templates = c.rpc("resources/templates/list");
        const json::Value skill = c.rpc("resources/read", json::Object{{"uri", kSkillUri}});
        const json::Value next = call_tool(c, "next_context", json::Object{});
        const json::Value* run = at(&next, {"result", "_meta", "com.anentrypoint.gmnew/run"});
        const json::Value log = c.rpc("resources/read", json::Object{{"uri", "run://" + string_of(run) + "/log"}});
        const json::Value* tools_r = tools.find("result");
        const json::Value* prompts_r = prompts.find("result");
        const json::Value* resources_r = resources.find("result");
        const json::Value* templates_r = templates.find("result");
        const json::Value* skill_r = skill.find("result");
        const json::Value* log_r = log.find("result");
        ok("tools/list carries ttlMs 3600000 and cacheScope public", cached(tools_r, kHourMs), brief(picked(tools_r, {"ttlMs", "cacheScope"})));
        ok("prompts/list carries ttlMs 3600000 and cacheScope public", cached(prompts_r, kHourMs), brief(picked(prompts_r, {"ttlMs", "cacheScope"})));
        ok("resources/list carries ttlMs 0 and cacheScope public", cached(resources_r, 0), brief(picked(resources_r, {"ttlMs", "cacheScope"})));
        ok("resources/templates/list carries ttlMs 3600000 and cacheScope public", cached(templates_r, kHourMs), brief(picked(templates_r, {"ttlMs", "cacheScope"})));
        ok("resources/read of a skill file carries ttlMs 0 and cacheScope public", cached(skill_r, 0), brief(picked(skill_r, {"ttlMs", "cacheScope"})));
        json::Value log_detail = picked(log_r, {"ttlMs", "cacheScope"});
        if (run != nullptr) log_detail.set("run", *run);
        ok("resources/read of a run log carries ttlMs 0 and cacheScope public", cached(log_r, 0), brief(log_detail));
    }});
    list.push_back({"tools/list", {}, [](Client& c, Recorder& ok) {
        const json::Value reply = c.rpc("tools/list");
        const json::Value* tools = at(&reply, {"result", "tools"});
        const json::Value empty = json::Array{};
        if (tools == nullptr || !tools->is_array()) tools = &empty;
        std::vector<std::string> names;
        std::string joined;
        for (const json::Value& tool : tools->as_array()) {
            names.push_back(string_of(tool.find("name")));
            joined += (joined.empty() ? "" : ",") + names.back();
        }
        ok("serves next_context, run_code and finish",
           std::all_of(kCodeTools.begin(), kCodeTools.end(), [&](const std::string& n) { return std::find(names.begin(), names.end(), n) != names.end(); }), joined);
        for (const json::Value& tool : tools->as_array()) {
            const json::Value* name = tool.find("name");
            if (name == nullptr || !name->is_string() || std::find(kCodeTools.begin(), kCodeTools.end(), name->as_string()) == kCodeTools.end()) continue;
            json::Value detail = json::Object{};
            if (const json::Value* title = tool.find("title")) detail.set("title", *title);
            if (const json::Value* input = at(&tool, {"inputSchema", "type"})) detail.set("input", *input);
            if (const json::Value* output = at(&tool, {"outputSchema", "type"})) detail.set("output", *output);
            ok(name->as_string() + " has a title, an object inputSchema and an object outputSchema",
               non_empty(tool.find("title")) && is_text(at(&tool, {"inputSchema", "type"}), "object") && is_text(at(&tool, {"outputSchema", "type"}), "object"), brief(detail));
        }
        const std::string run_code_description = tool_description(tools, "run_code");
        const json::Value* description_value = at(find_named(tools, "run_code"), {"description"});
        ok("run_code names gm.verbs and gm.try", contains(run_code_description, "gm.verbs()") && contains(run_code_description, "gm.try(fn)"),
           description_value != nullptr && description_value->is_string() ? brief(json::Value(run_code_description.substr(0, 120))) : "undefined");
        ok("next_context is read-only", is_true(at(find_named(tools, "next_context"), {"annotations", "readOnlyHint"})));
        const json::Value* next_schema = at(find_named(tools, "next_context"), {"inputSchema", "properties"});
        ok("next_context declares task and owner", is_text(at(next_schema, {"task", "type"}), "string") && is_text(at(next_schema, {"owner", "type"}), "boolean"),
           next_schema != nullptr ? brief(next_schema) : "{}");
        ok("run_code description names outputPath and query_log field paging", contains(run_code_description, "outputPath") && contains(run_code_description, "query_log"),
           brief(json::Value(run_code_description.substr(0, 160))));
        ok("finish is not destructive", is_false(at(find_named(tools, "finish"), {"annotations", "destructiveHint"})));
    }});
    list.push_back({"tools/call next_context", {}, [](Client& c, Recorder& ok) {
        const json::Value reply = call_tool(c, "next_context", json::Object{});
        const json::Value* r = reply.find("result");
        const json::Value* item = first(at(r, {"content"}));
        ok("result has a text content item", is_text(at(item, {"type"}), "text"), brief(at(item, {"type"})));
        const json::Value* structured_content = at(r, {"structuredContent"});
        ok("structuredContent carries a boolean ok", at(structured_content, {"ok"}) != nullptr && at(structured_content, {"ok"})->is_bool(), brief(structured_content));
        bool same = false;
        const json::Value* text = at(item, {"text"});
        if (text != nullptr && text->is_string() && structured_content != nullptr) {
            auto parsed = json::parse(text->as_string());
            same = parsed && *parsed == *structured_content;
        }
        ok("text content is the same JSON as structuredContent", same);
    }});
    list.push_back({"tools/call run_code", {}, [](Client& c, Recorder& ok) {
        const json::Value reply = call_tool(c, "run_code", json::Object{{"body", "return 2"}});
        const json::Value* r = reply.find("result");
        const json::Value* item = first(at(r, {"content"}));
        ok("result has a text content item", is_text(at(item, {"type"}), "text"), brief(at(item, {"type"})));
        const json::Value* structured_content = at(r, {"structuredContent"});
        ok("structuredContent carries a boolean ok", at(structured_content, {"ok"}) != nullptr && at(structured_content, {"ok"})->is_bool(), brief(structured_content));
        const json::Value verbs = code_output(c,
            "const all = gm.verbs(); const one = gm.verbs({ name: 'read_file' }); const names = gm.verbs({ names: true }); return { count: all.length, full: all.every((v) => typeof v.description === 'string' && v.inputSchema !== null && typeof v.inputSchema === 'object'), one, names };");
        const json::Value* count = verbs.find("count");
        const double count_value = count != nullptr && count->is_number() ? count->as_number() : -1;
        ok("gm.verbs() still returns every schema", is_true(verbs.find("full")) && count_value > 1, brief(count));
        const json::Value* one = verbs.find("one");
        const json::Value* one_schema = at(one, {"inputSchema"});
        ok("gm.verbs({ name }) returns one schema", is_text(at(one, {"name"}), "read_file") && one_schema != nullptr && (one_schema->is_object() || one_schema->is_array() || one_schema->is_null()),
           brief(one));
        const json::Value* names = verbs.find("names");
        const bool names_ok = names != nullptr && names->is_array() && count != nullptr && count->is_number() && static_cast<double>(names->as_array().size()) == count_value &&
                              std::all_of(names->as_array().begin(), names->as_array().end(), [](const json::Value& n) { return n.is_string(); });
        ok("gm.verbs({ names: true }) returns just the names", names_ok,
           names != nullptr && names->is_array() ? std::to_string(names->as_array().size()) : "undefined");
        const json::Value api = code_output(c,
            "const names = ['task_set', 'query_log', 'grep', 'fetch', 'prd_receipt', 'prd_refute', 'prd_reopen']; return Object.fromEntries(names.map((name) => [name, gm.verbs({ name })?.inputSchema?.properties ?? {}]));");
        const json::Value* task_type = at(&api, {"task_set", "task", "type"});
        bool task_is_string = is_text(task_type, "string");
        if (task_type != nullptr && task_type->is_array())
            task_is_string = std::any_of(task_type->as_array().begin(), task_type->as_array().end(), [](const json::Value& t) { return is_text(&t, "string"); });
        ok("task_set declares task and owner", task_is_string && is_text(at(&api, {"task_set", "owner", "type"}), "boolean"), brief(at(&api, {"task_set"})));
        const json::Value* query_log = at(&api, {"query_log"});
        const std::vector<std::string_view> paging{"seq", "field", "offset", "limit", "unit"};
        ok("query_log declares field paging", std::all_of(paging.begin(), paging.end(), [&](std::string_view key) { return truthy(at(query_log, {key})); }), brief(query_log));
        ok("grep declares resumeFrom", truthy(at(&api, {"grep", "resumeFrom"})), brief(at(&api, {"grep", "resumeFrom"})));
        ok("fetch declares maxBytes", truthy(at(&api, {"fetch", "maxBytes"})), brief(at(&api, {"fetch", "maxBytes"})));
        ok("prd_receipt declares witness and commit", is_text(at(&api, {"prd_receipt", "witness", "type"}), "string") && is_text(at(&api, {"prd_receipt", "commit", "type"}), "string"),
           brief(at(&api, {"prd_receipt"})));
        ok("prd_reopen declares from and reason", truthy(at(&api, {"prd_reopen", "from"})) && is_text(at(&api, {"prd_reopen", "reason", "type"}), "string"), brief(at(&api, {"prd_reopen"})));
        const json::Value unknown = code_output(c, "return await gm.try(() => gm.verbs({ name: 'no_such_verb' }));");
        ok("an unknown verb name is a clear error", is_false(unknown.find("ok")) && contains(string_of(unknown.find("error")), "no_such_verb"), brief(unknown));
        const json::Value shapes = code_output(c,
            "const all = gm.verbs({}); const array = gm.verbs({ names: ['read_file'] }); const unknownKey = gm.verbs({ nope: 1 }); const scalar = gm.verbs(7); return { count: all.length, array, unknownKey, scalar, tail: 'still here' };");
        const json::Value* shapes_count = shapes.find("count");
        ok("gm.verbs({}) returns every schema", shapes_count != nullptr && shapes_count->is_number() && shapes_count->as_number() > 1, brief(shapes_count));
        bool refused = true;
        for (const char* key : {"array", "unknownKey", "scalar"}) {
            const json::Value* part = shapes.find(key);
            if (!is_false(at(part, {"ok"})) || at(part, {"error"}) == nullptr || !at(part, {"error"})->is_string()) refused = false;
        }
        ok("bad gm.verbs arguments return data and the body continues", is_text(shapes.find("tail"), "still here") && refused, brief(shapes));
    }});
    list.push_back({"tools/call finish without a witness", {}, [](Client& c, Recorder& ok) {
        const json::Value r = call_tool(c, "finish", json::Object{});
        ok("a missing required witness is -32602 or an isError result", error_code(r, kInvalidParams) || is_true(at(&r, {"result", "isError"})), brief(r));
    }});
    list.push_back({"tools/call unknown tool", {}, [](Client& c, Recorder& ok) {
        const json::Value r = call_tool(c, "no_such_tool", json::Object{});
        ok("an unknown tool is -32602", error_code(r, kInvalidParams), brief(r));
    }});
    list.push_back({"tools/call without a name", {}, [](Client& c, Recorder& ok) {
        const json::Value r = c.rpc("tools/call", json::Object{});
        ok("a tools/call without a name is -32602", error_code(r, kInvalidParams), brief(r));
    }});
    list.push_back({"prompts/list", {}, [](Client& c, Recorder& ok) {
        const json::Value reply = c.rpc("prompts/list");
        const json::Value* prompts = at(&reply, {"result", "prompts"});
        json::Value names = json::Array{};
        if (prompts != nullptr && prompts->is_array())
            for (const json::Value& p : prompts->as_array()) names.push(p.find("name") != nullptr ? *p.find("name") : json::Value());
        const json::Value* gm = find_named(prompts, "gm");
        ok("serves the gm prompt", gm != nullptr, brief(names));
        ok("the gm prompt has a description", non_empty(at(gm, {"description"})));
        const json::Value* arguments = at(gm, {"arguments"});
        bool optional_task = false;
        if (arguments != nullptr && arguments->is_array())
            optional_task = std::any_of(arguments->as_array().begin(), arguments->as_array().end(),
                                        [](const json::Value& a) { return is_text(a.find("name"), "task") && !is_true(a.find("required")); });
        ok("the gm prompt takes an optional task argument", optional_task, brief(arguments));
    }});
    list.push_back({"prompts/get gm", {}, [](Client& c, Recorder& ok) {
        const json::Value reply = c.rpc("prompts/get", json::Object{{"name", "gm"}, {"arguments", json::Object{{"task", "conformance"}}}});
        const json::Value* message = first(at(&reply, {"result", "messages"}));
        ok("returns a user message", is_text(at(message, {"role"}), "user"), brief(at(message, {"role"})));
        ok("the message content is text", is_text(at(message, {"content", "type"}), "text") && non_empty(at(message, {"content", "text"})), brief(at(message, {"content", "type"})));
        const json::Value* text = at(message, {"content", "text"});
        const std::string prompt = text == nullptr ? std::string() : string_of(text);
        const bool workflow = contains(prompt, kWorkflowUri);
        const bool reread = contains(prompt, "after a compaction re-read");
        ok("the gm prompt names the workflow graph and its compaction re-read", workflow && reread, brief(json::Value(json::Object{{"workflow", workflow}, {"reread", reread}})));
    }});
    list.push_back({"prompts/get unknown prompt", {}, [](Client& c, Recorder& ok) {
        const json::Value r = c.rpc("prompts/get", json::Object{{"name", "no_such_prompt"}});
        ok("an unknown prompt is -32602", error_code(r, kInvalidParams), brief(r));
    }});
    list.push_back({"resources/list", {}, [](Client& c, Recorder& ok) {
        const json::Value reply = c.rpc("resources/list");
        const json::Value* resources = at(&reply, {"result", "resources"});
        const json::Value empty = json::Array{};
        if (resources == nullptr || !resources->is_array()) resources = &empty;
        json::Value uris = json::Array{};
        bool skill = false;
        bool workflow = false;
        bool named = true;
        for (const json::Value& r : resources->as_array()) {
            uris.push(r.find("uri") != nullptr ? *r.find("uri") : json::Value());
            skill = skill || is_text(r.find("uri"), kSkillUri);
            workflow = workflow || is_text(r.find("uri"), kWorkflowUri);
            named = named && non_empty(r.find("uri")) && non_empty(r.find("name"));
        }
        ok("lists the gm skill", skill, brief(uris));
        ok("lists the workflow graph", workflow, brief(uris));
        ok("every resource has a uri and a name", named);
    }});
    list.push_back({"resources/templates/list", {}, [](Client& c, Recorder& ok) {
        const json::Value reply = c.rpc("resources/templates/list");
        const json::Value* templates = at(&reply, {"result", "resourceTemplates"});
        const json::Value empty = json::Array{};
        if (templates == nullptr || !templates->is_array()) templates = &empty;
        ok("lists at least one resource template", !templates->as_array().empty(), brief(templates));
        ok("every template has a uriTemplate and a name", std::all_of(templates->as_array().begin(), templates->as_array().end(), [](const json::Value& t) {
               return non_empty(t.find("uriTemplate")) && non_empty(t.find("name"));
           }));
    }});
    list.push_back({"resources/read skill", {}, [](Client& c, Recorder& ok) {
        const json::Value reply = c.rpc("resources/read", json::Object{{"uri", kSkillUri}});
        const json::Value* item = first(at(&reply, {"result", "contents"}));
        ok("contents is the requested skill uri", is_text(at(item, {"uri"}), kSkillUri), brief(at(item, {"uri"})));
        ok("the skill text is non-empty", non_empty(at(item, {"text"})));
        const json::Value graph_reply = c.rpc("resources/read", json::Object{{"uri", kWorkflowUri}});
        const json::Value* graph = first(at(&graph_reply, {"result", "contents"}));
        const json::Value* graph_text = at(graph, {"text"});
        const std::string text = graph_text == nullptr ? std::string() : string_of(graph_text);
        json::Value detail = json::Object{};
        if (const json::Value* uri = at(graph, {"uri"})) detail.set("uri", *uri);
        detail.set("chars", static_cast<std::uint64_t>(text.size()));
        ok("the workflow graph is served with its work order and step budget",
           is_text(at(graph, {"uri"}), kWorkflowUri) && contains(text, "## Work order") && contains(text, "stepsLeft"), brief(detail));
    }});
    list.push_back({"resources/read missing", {}, [](Client& c, Recorder& ok) {
        const json::Value r = c.rpc("resources/read", json::Object{{"uri", kMissingUri}});
        ok("a missing resource is -32002 with data.uri and no contents",
           error_code(r, kResourceNotFound) && is_text(at(&r, {"error", "data", "uri"}), kMissingUri) && r.find("result") == nullptr, brief(r));
    }});
    list.push_back({"subscriptions/listen", {}, [](Client& c, Recorder& ok) {
        const std::int64_t listen_id = c.next_id++;
        c.send(json::Object{{"jsonrpc", "2.0"}, {"id", listen_id}, {"method", "subscriptions/listen"},
                            {"params", json::Object{{"notifications", json::Object{{"resourceSubscriptions", json::Array{kSkillUri}}}}}}});
        const json::Value ack = c.wait_for([](const json::Value& m) { return is_text(m.find("method"), "notifications/subscriptions/acknowledged"); },
                                           "subscriptions/acknowledged notification");
        const json::Value* subscriptions = at(&ack, {"params", "notifications", "resourceSubscriptions"});
        bool names_skill = false;
        if (subscriptions != nullptr && subscriptions->is_array())
            names_skill = std::any_of(subscriptions->as_array().begin(), subscriptions->as_array().end(), [](const json::Value& u) { return is_text(&u, kSkillUri); });
        ok("the acknowledgement names the skill subscription", names_skill, brief(at(&ack, {"params"})));
        ok("the acknowledgement carries the listen request id as subscriptionId",
           is_number(at(&ack, {"params", "_meta", "io.modelcontextprotocol/subscriptionId"}), static_cast<double>(listen_id)), brief(at(&ack, {"params", "_meta"})));
        c.send(json::Object{{"jsonrpc", "2.0"}, {"method", "notifications/cancelled"}, {"params", json::Object{{"requestId", listen_id}}}});
        const json::Value done = c.wait_for([listen_id](const json::Value& m) { return is_number(m.find("id"), static_cast<double>(listen_id)); }, "subscriptions/listen result");
        ok("cancelling the stream answers subscriptions/listen with a complete result", is_text(at(&done, {"result", "resultType"}), "complete"), brief(done));
    }});
    list.push_back({"subscriptions/listen missing", {}, [](Client& c, Recorder& ok) {
        const json::Value r = c.rpc("subscriptions/listen", json::Object{{"notifications", json::Object{{"resourceSubscriptions", json::Array{kMissingUri}}}}});
        ok("subscriptions/listen of a missing resource is -32002", error_code(r, kResourceNotFound), brief(r));
    }});
    list.push_back({"resources/subscribe", {}, [](Client& c, Recorder& ok) {
        const json::Value sub = c.rpc("resources/subscribe", json::Object{{"uri", kSkillUri}});
        const json::Value unsub = c.rpc("resources/unsubscribe", json::Object{{"uri", kSkillUri}});
        const json::Value missing = c.rpc("resources/subscribe", json::Object{{"uri", kMissingUri}});
        ok("resources/subscribe of a served skill answers an empty result", sub.find("error") == nullptr && empty_result(sub.find("result")), brief(sub));
        ok("resources/unsubscribe of the same skill answers an empty result", unsub.find("error") == nullptr && empty_result(unsub.find("result")), brief(unsub));
        ok("resources/subscribe of a missing resource is refused", missing.find("error") != nullptr, brief(missing));
    }});
    list.push_back({"logging/setLevel", {}, [](Client& c, Recorder& ok) {
        json::Value results = json::Array{};
        bool all_empty = true;
        for (const std::string& level : kLogLevels) {
            const json::Value reply = c.rpc("logging/setLevel", json::Object{{"level", level}});
            const json::Value* result = reply.find("result");
            results.push(result != nullptr ? *result : json::Value());
            all_empty = all_empty && empty_result(result);
        }
        ok("accepts every RFC 5424 level", all_empty, brief(results));
    }});
    list.push_back({"ping", {}, [](Client& c, Recorder& ok) {
        const json::Value r = c.rpc("ping");
        ok("ping answers an empty result", empty_result(r.find("result")), brief(r));
    }});
    list.push_back({"method not found", {}, [](Client& c, Recorder& ok) {
        const json::Value r = c.rpc("no/such/method");
        ok("an unknown method is -32601", error_code(r, kMethodNotFound), brief(r));
    }});
    list.push_back({"rules notice after successor", {"--run-dir", rules_dir.string()}, [](Client& c, Recorder& ok) {
        const json::Value early = structured(c, "run_code", json::Object{{"body", "return 1"}});
        ok("run_code before the first next_context carries rule 2", contains(string_of(early.find("rulesNotice")), "rule 2"), brief(early.find("rulesNotice")));
        const json::Value first_step = structured(c, "next_context", json::Object{});
        structured(c, "run_code", json::Object{{"body", "return 2"}});
        structured(c, "finish", json::Object{{"witness", "successor rules notice check"}});
        const json::Value successor = structured(c, "next_context", json::Object{});
        json::Value detail = json::Object{};
        if (const json::Value* run = first_step.find("run")) detail.set("first", *run);
        if (const json::Value* run = successor.find("run")) detail.set("successor", *run);
        ok("next_context after finish opens a fresh run", !same_value(successor.find("run"), first_step.find("run")) && first_step.find("run") != nullptr, brief(detail));
        const json::Value after = structured(c, "run_code", json::Object{{"body", "return 3"}});
        ok("the successor run does not inherit the rule 2 notice", after.find("rulesNotice") == nullptr, brief(after.find("rulesNotice")));
    }});
    list.push_back({"step budget handoff", {"--run-dir", handoff_dir.string()}, [&context, step_limit_dir](Client& c, Recorder& ok) {
        json::Value fiftieth = json::Object{};
        json::Value fortyninth = json::Object{};
        for (int step = 1; step <= 50; ++step) {
            fortyninth = fiftieth;
            fiftieth = structured(c, "next_context", json::Object{{"full", true}});
        }
        ok("50 next_context calls reach stepsLeft 0", is_true(fiftieth.find("ok")) && is_number(fiftieth.find("step"), 50) && is_number(fiftieth.find("stepsLeft"), 0),
           brief(picked(&fiftieth, {"step", "stepsLeft"})));
        ok("the 50th next_context at stepsLeft 0 warns that the next next_context ends the run without a witness", is_text(fiftieth.find("warning"), kStepWarning),
           brief(fiftieth.find("warning")));
        ok("the 49th next_context at stepsLeft 1 carries no warning", is_number(fortyninth.find("stepsLeft"), 1) && fortyninth.find("warning") == nullptr,
           brief(picked(&fortyninth, {"stepsLeft", "warning"})));
        const json::Value done = structured(c, "finish", json::Object{{"witness", "step budget handoff witness"}});
        ok("finish with a witness succeeds at stepsLeft 0", is_true(done.find("ok")), brief(done));
        const json::Value successor = structured(c, "next_context", json::Object{});
        json::Value detail = json::Object{};
        if (const json::Value* run = fiftieth.find("run")) detail.set("first", *run);
        if (const json::Value* run = successor.find("run")) detail.set("successor", *run);
        ok("the next next_context opens a different run",
           is_true(successor.find("ok")) && successor.find("run") != nullptr && !same_value(successor.find("run"), fiftieth.find("run")), brief(detail));
        Client limited(context.argv({"--run-dir", step_limit_dir.string()}), context.workspace, context.home);
        limited.open();
        json::Value fiftieth_limited = json::Object{};
        for (int step = 1; step <= 50; ++step) fiftieth_limited = structured(limited, "next_context", json::Object{{"full", true}});
        const std::int64_t retry_id = limited.next_id;
        const json::Value refused = structured(limited, "next_context", json::Object{});
        ok("the 51st next_context is refused with the truthful step-limit text",
           is_false(refused.find("ok")) && is_true(refused.find("refused")) && is_text(refused.find("error"), kStepRefusal), brief(refused.find("error")));
        limited.drop(retry_id);
        limited.send(json::Object{{"jsonrpc", "2.0"}, {"id", retry_id}, {"method", "tools/call"}, {"params", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}}}});
        const json::Value retry_reply = limited.wait_for([retry_id](const json::Value& m) { return is_number(m.find("id"), static_cast<double>(retry_id)); }, "answer to repeated step-limit id");
        const json::Value* retried_found = at(&retry_reply, {"result", "structuredContent"});
        const json::Value retried = retried_found != nullptr ? *retried_found : json::Object{};
        ok("a repeated over-limit id answers with the stored refusal",
           is_false(retried.find("ok")) && is_true(retried.find("refused")) && is_text(retried.find("error"), kStepRefusal), brief(retried.find("error")));
        const json::Value after_refusal = structured(limited, "next_context", json::Object{});
        json::Value after_detail = json::Object{};
        if (const json::Value* run = fiftieth_limited.find("run")) after_detail.set("first", *run);
        if (const json::Value* run = after_refusal.find("run")) after_detail.set("successor", *run);
        ok("the next new next_context after a step-limit refusal opens a different run",
           is_true(after_refusal.find("ok")) && is_number(after_refusal.find("step"), 1) && after_refusal.find("run") != nullptr &&
               !same_value(after_refusal.find("run"), fiftieth_limited.find("run")),
           brief(after_detail));
    }});
    return list;
}

}

CheckResult check_mcp_conformance(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-conformance-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    const fs::path config = sandbox / "quiet.json";
    std::ofstream(config) << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const Context context{binary, workspace, sandbox, config};
    const std::vector<Scenario> list = scenarios(context, sandbox / "rules", sandbox / "handoff", sandbox / "step-limit");
    Recorder record;
    record.failures = &result.failures;
    for (const Scenario& scenario : list) {
        record.scenario = scenario.name;
        Client client(context.argv(scenario.args), workspace, sandbox);
        try {
            client.open();
            scenario.run(client, record);
        } catch (const std::exception& error) {
            record(scenario.name + " runs to completion", false, error.what());
        }
        client.close();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "conformance: " + std::to_string(record.passed) + " passed, " + std::to_string(record.failed) + " failed of " + std::to_string(record.passed + record.failed) +
                     " checks in " + std::to_string(list.size()) + " scenarios (wall " + std::to_string(wall) + " s)";
    return result;
}

}
