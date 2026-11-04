#include "client.hpp"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iterator>
#include <map>
#include <set>
#include <thread>
#include <utility>

namespace gmnew::playwriter {

namespace {

constexpr const char* PROTOCOL_VERSIONS[] = {"2025-11-25", "2025-06-18"};
constexpr const char* DEPTH_VARIABLE = "GMNEW_MCP_DEPTH";
constexpr const char* CLIENT_NAME = "gm-new";
constexpr const char* CLIENT_VERSION = "0.1.0";
constexpr int METHOD_NOT_FOUND = -32601;

json::Value failure(const std::string& text) {
    json::Value reply;
    reply.set("ok", false).set("error", text);
    return reply;
}

json::Value outcome_of(const json::Value& result) {
    std::string output;
    const json::Value* content = result.find("content");
    if (content != nullptr && content->is_array()) {
        bool first = true;
        for (const json::Value& part : content->as_array()) {
            if (!first) output += '\n';
            first = false;
            const json::Value* type = part.find("type");
            const std::string kind = type != nullptr && type->is_string() ? type->as_string() : std::string();
            if (kind == "text") {
                const json::Value* text = part.find("text");
                if (text != nullptr && text->is_string()) output += text->as_string();
                continue;
            }
            output += "[" + kind;
            const json::Value* mime = part.find("mimeType");
            if (mime != nullptr && mime->is_string()) output += " " + mime->as_string();
            output += "]";
        }
    }
    const json::Value* is_error = result.find("isError");
    const bool failed = is_error != nullptr && is_error->is_bool() && is_error->as_bool();
    json::Value reply;
    reply.set("ok", !failed).set("output", output);
    if (const json::Value* structured = result.find("structuredContent")) reply.set("data", *structured);
    if (failed) reply.set("error", output.empty() ? std::string("the tool reported an error") : output);
    return reply;
}

std::vector<std::string> launch_argv(const ServerSpec& spec) {
    std::vector<std::string> argv;
#if defined(_WIN32)
    if (spec.command == "npx" || spec.command == "npm") {
        const char* shell = std::getenv("ComSpec");
        argv = {shell != nullptr ? shell : "cmd.exe", "/d", "/s", "/c", spec.command};
        argv.insert(argv.end(), spec.args.begin(), spec.args.end());
        return argv;
    }
#endif
    argv.push_back(spec.command);
    argv.insert(argv.end(), spec.args.begin(), spec.args.end());
    return argv;
}

}

struct Session {
    std::mutex mutex;
    std::condition_variable changed;
    bool alive = true;
    std::int64_t last_id = 0;
    std::set<std::int64_t> pending;
    std::map<std::int64_t, json::Value> replies;
};

namespace {

json::Value reply_to_server_request(const json::Value& id, const json::Value& method) {
    json::Value reply;
    reply.set("jsonrpc", "2.0").set("id", id);
    if (method.is_string() && method.as_string() == "ping") {
        reply.set("result", json::Object{});
    } else {
        const std::string name = method.is_string() ? method.as_string() : std::string();
        json::Value error;
        error.set("code", METHOD_NOT_FOUND).set("message", "gm-new does not serve " + name);
        reply.set("error", error);
    }
    return reply;
}

void pump(std::shared_ptr<proc::Child> child, std::shared_ptr<Session> session) {
    while (std::optional<std::string> line = child->read_line()) {
        const auto parsed = json::parse(*line);
        if (!parsed) continue;
        const json::Value* method = parsed->find("method");
        const json::Value* id = parsed->find("id");
        if (method != nullptr && id != nullptr) {
            child->write_line(json::dump(reply_to_server_request(*id, *method)));
            continue;
        }
        if (method != nullptr || id == nullptr || !id->is_number()) continue;
        const auto key = static_cast<std::int64_t>(id->as_number());
        {
            std::lock_guard lock(session->mutex);
            if (session->pending.count(key) != 0) session->replies.insert_or_assign(key, *parsed);
        }
        session->changed.notify_all();
    }
    {
        std::lock_guard lock(session->mutex);
        session->alive = false;
    }
    session->changed.notify_all();
}

}

StdioClient::StdioClient(ServerSpec spec, std::size_t depth) : spec_(std::move(spec)), depth_(depth) {}

StdioClient::~StdioClient() { stop(); }

StdioClient::Snapshot StdioClient::snapshot() const {
    std::lock_guard lock(mutex_);
    return {child_, session_};
}

bool StdioClient::running() const {
    const Snapshot current = snapshot();
    if (!current.session) return false;
    std::lock_guard lock(current.session->mutex);
    return current.session->alive;
}

std::optional<std::string> StdioClient::ensure_running() {
    std::lock_guard lock(start_mutex_);
    if (running()) return std::nullopt;
    kill_current();
    return start();
}

std::optional<std::string> StdioClient::start() {
    proc::SpawnOptions options(spec_.cwd);
    options.own_group = true;
    options.env = spec_.env;
    options.env.emplace_back(DEPTH_VARIABLE, std::to_string(depth_ + 1));
    auto spawned = proc::Child::spawn(launch_argv(spec_), options);
    if (!spawned) return spawned.error();
    auto session = std::make_shared<Session>();
    {
        std::lock_guard lock(mutex_);
        child_ = *spawned;
        session_ = session;
    }
    std::thread(pump, *spawned, session).detach();
    if (auto error = handshake()) {
        kill_current();
        return error;
    }
    return std::nullopt;
}

std::optional<std::string> StdioClient::handshake() {
    json::Value params;
    params.set("protocolVersion", PROTOCOL_VERSIONS[0]).set("capabilities", json::Object{});
    json::Value client_info;
    client_info.set("name", CLIENT_NAME).set("version", CLIENT_VERSION);
    params.set("clientInfo", client_info);
    auto init = request("initialize", params, spec_.startup_ms);
    if (!init) return init.error();
    const json::Value* version = init->find("protocolVersion");
    const std::string text = version != nullptr && version->is_string() ? version->as_string() : std::string();
    if (std::find_if(std::begin(PROTOCOL_VERSIONS), std::end(PROTOCOL_VERSIONS), [&](const char* known) { return text == known; }) ==
        std::end(PROTOCOL_VERSIONS))
        return "protocol version " + text + " is not one gm-new speaks";
    notify("notifications/initialized", json::Value());
    return list_tools();
}

std::optional<std::string> StdioClient::list_tools() {
    std::vector<json::Value> tools;
    std::set<std::string> seen;
    std::optional<std::string> cursor;
    for (;;) {
        json::Value params{json::Object{}};
        if (cursor) params.set("cursor", *cursor);
        auto page = request("tools/list", params, spec_.startup_ms);
        if (!page) return page.error();
        const json::Value* list = page->find("tools");
        if (list != nullptr && list->is_array()) tools.insert(tools.end(), list->as_array().begin(), list->as_array().end());
        const json::Value* next = page->find("nextCursor");
        cursor = next != nullptr && next->is_string() && !next->as_string().empty() ? std::optional<std::string>(next->as_string())
                                                                                   : std::nullopt;
        if (!cursor || !seen.insert(*cursor).second) break;
    }
    tools_ = std::move(tools);
    return std::nullopt;
}

deoxidene::Result<json::Value, std::string> StdioClient::request(const std::string& method, const json::Value& params,
                                                                 std::uint64_t timeout_ms) {
    const std::string not_running = "MCP server " + spec_.name + " is not running";
    const Snapshot current = snapshot();
    if (!current.child || !current.session) return deoxidene::Err<std::string>(not_running);
    Session& session = *current.session;
    std::int64_t id = 0;
    {
        std::lock_guard lock(session.mutex);
        if (!session.alive) return deoxidene::Err<std::string>(not_running);
        id = ++session.last_id;
        session.pending.insert(id);
    }
    json::Value message;
    message.set("jsonrpc", "2.0").set("id", id).set("method", method).set("params", params);
    if (!current.child->write_line(json::dump(message))) {
        std::lock_guard lock(session.mutex);
        session.pending.erase(id);
        return deoxidene::Err<std::string>(not_running);
    }
    std::unique_lock lock(session.mutex);
    session.changed.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                             [&] { return session.replies.count(id) != 0 || !session.alive; });
    session.pending.erase(id);
    const auto found = session.replies.find(id);
    if (found == session.replies.end()) {
        const bool exited = !session.alive;
        lock.unlock();
        if (exited) return deoxidene::Err<std::string>("MCP server " + spec_.name + " exited");
        json::Value cancel;
        cancel.set("requestId", id).set("reason", "timed out after " + std::to_string(timeout_ms) + " ms");
        notify("notifications/cancelled", cancel);
        return deoxidene::Err<std::string>(method + " timed out after " + std::to_string(timeout_ms) + " ms");
    }
    json::Value reply = std::move(found->second);
    session.replies.erase(found);
    lock.unlock();
    if (const json::Value* error = reply.find("error")) {
        const json::Value* text = error->find("message");
        return deoxidene::Err<std::string>(text != nullptr && text->is_string() ? text->as_string() : std::string("the server returned an error"));
    }
    const json::Value* result = reply.find("result");
    return result != nullptr ? *result : json::Value(json::Object{});
}

void StdioClient::notify(const std::string& method, const json::Value& params) {
    const Snapshot current = snapshot();
    if (!current.child) return;
    json::Value message;
    message.set("jsonrpc", "2.0").set("method", method);
    if (!params.is_null()) message.set("params", params);
    current.child->write_line(json::dump(message));
}

json::Value StdioClient::call_tool(const std::string& tool, const json::Value& args) {
    if (auto error = ensure_running()) return failure("MCP server " + spec_.name + " is not running: " + *error);
    json::Value params;
    params.set("name", tool).set("arguments", args);
    auto reply = request("tools/call", params, spec_.timeout_ms);
    if (!reply) return failure(reply.error());
    return outcome_of(*reply);
}

void StdioClient::kill_current() {
    Snapshot current;
    {
        std::lock_guard lock(mutex_);
        current = {child_, session_};
        child_.reset();
        session_.reset();
    }
    if (current.session) {
        {
            std::lock_guard lock(current.session->mutex);
            current.session->alive = false;
        }
        current.session->changed.notify_all();
    }
    if (current.child) {
#if defined(_WIN32)
        proc::run({"taskkill", "/T", "/F", "/PID", std::to_string(current.child->pid())});
#endif
        current.child->close_input();
        current.child->kill();
    }
}

void StdioClient::stop() {
    std::lock_guard lock(start_mutex_);
    kill_current();
}

}
