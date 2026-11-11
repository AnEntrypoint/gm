#include "client.hpp"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <cstdlib>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <utility>

#include "gm/proc.hpp"
#include "transport.hpp"

namespace gm::mcpclient {

struct Session {
    std::shared_ptr<proc::Child> child;
    ChildTransport* transport = nullptr;
    std::unique_ptr<mcp::client::Client> client;
    std::mutex mutex;
    std::condition_variable changed;
    bool errors_done = false;
};

struct Core {
    ServerSpec spec;
    std::size_t depth = 0;
    Emit emit;
    std::mutex mutex;
    std::shared_ptr<Session> current;
    std::string stderr_tail;
    bool closing = false;
};

namespace {

constexpr const char* PROTOCOL_VERSIONS[] = {"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"};
constexpr const char* DEPTH_VARIABLE = "GMNEW_MCP_DEPTH";
constexpr const char* PROJECT_VARIABLE = "PLAYWRITER_PROJECT_DIR";
constexpr const char* CLIENT_NAME = "gm";
constexpr const char* CLIENT_VERSION = "0.1.0";
constexpr std::size_t STDERR_BYTES = 2000;
constexpr auto ERROR_DRAIN = std::chrono::milliseconds(1000);
constexpr auto EXIT_WAIT = std::chrono::milliseconds(5000);
constexpr int STARTUP_ATTEMPTS = 3;
constexpr std::size_t STARTUP_TAIL_CHARS = 500;

json::Value failure(const std::string& text) {
    json::Value reply;
    reply.set("ok", false).set("error", text);
    return reply;
}

json::Value strings_of(const std::vector<std::string>& items) {
    json::Value list{json::Array{}};
    for (const std::string& item : items) list.push(json::Value(item));
    return list;
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

std::string stderr_of(Core& core) {
    std::lock_guard lock(core.mutex);
    return core.stderr_tail;
}

void announce(Core& core, std::string_view kind, json::Value fields) {
    if (core.emit) core.emit(kind, std::move(fields));
}

std::string trim_text(const std::string& text) {
    const auto first = text.find_first_not_of(" \t\r\n\f\v");
    if (first == std::string::npos) return {};
    return text.substr(first, text.find_last_not_of(" \t\r\n\f\v") - first + 1);
}

std::string startup_failure(const ServerSpec& spec, const std::vector<std::string>& attempts, const std::string& stderr_text) {
    std::string joined;
    for (const std::string& attempt : attempts) joined += (joined.empty() ? "" : "; then ") + attempt;
    const std::string trimmed = trim_text(stderr_text);
    const std::string tail = trimmed.size() > STARTUP_TAIL_CHARS ? trimmed.substr(trimmed.size() - STARTUP_TAIL_CHARS) : trimmed;
    return "MCP server " + spec.name + " did not start after " + std::to_string(attempts.size()) + " attempt(s): " + joined + ". Startup budget " +
           std::to_string(spec.startup_ms) + " ms (" + (spec.startup_default ? "default" : "startupTimeoutMs") + "). stderr: " + (tail.empty() ? "(empty)" : tail);
}

std::string exit_reason(proc::Child& child) {
    const auto code = child.wait_for(EXIT_WAIT);
    return code ? "exited with code " + std::to_string(*code) : std::string("exited");
}

mcp::protocol::Json to_wire(const json::Value& value) { return mcp::protocol::Json::parse(json::dump(value), nullptr, false); }

json::Value from_wire(const mcp::protocol::Json& value) {
    const auto parsed = json::parse(value.dump());
    return parsed ? *parsed : json::Value();
}

std::shared_ptr<Session> current(const std::shared_ptr<Core>& core) {
    std::lock_guard lock(core->mutex);
    return core->current;
}

bool running(const std::shared_ptr<Core>& core) {
    const std::shared_ptr<Session> session = current(core);
    return session && session->transport->alive();
}

void lose(const std::shared_ptr<Core>& core, const std::shared_ptr<Session>& session, const std::string& reason) {
    {
        std::lock_guard lock(core->mutex);
        if (core->current != session) return;
        core->current.reset();
    }
    session->child->close_input();
    json::Value fields;
    fields.set("server", core->spec.name).set("state", "down").set("reason", reason).set("stderr", stderr_of(*core));
    announce(*core, "mcp-server", fields);
    session->transport->abort(reason);
}

void pump(std::shared_ptr<Core> core, std::shared_ptr<Session> session) {
    while (std::optional<std::string> line = session->child->read_line()) session->transport->dispatch(*line);
    {
        std::unique_lock lock(session->mutex);
        session->changed.wait_for(lock, ERROR_DRAIN, [&] { return session->errors_done; });
    }
    lose(core, session, exit_reason(*session->child));
}

void drain_errors(std::shared_ptr<Core> core, std::shared_ptr<Session> session) {
    while (std::optional<std::string> chunk = session->child->read_error_chunk()) {
        std::lock_guard lock(core->mutex);
        core->stderr_tail += *chunk;
        if (core->stderr_tail.size() > STDERR_BYTES) core->stderr_tail.erase(0, core->stderr_tail.size() - STDERR_BYTES);
    }
    {
        std::lock_guard lock(session->mutex);
        session->errors_done = true;
    }
    session->changed.notify_all();
}

std::vector<std::string> add_ignore_lines(const std::filesystem::path& file, const std::vector<std::string>& wanted) {
    std::string text;
    if (std::filesystem::exists(file)) {
        std::ifstream in(file, std::ios::binary);
        std::ostringstream buffer;
        buffer << in.rdbuf();
        text = buffer.str();
    }
    std::set<std::string> present;
    std::istringstream existing(text);
    for (std::string line; std::getline(existing, line);) {
        const auto first = line.find_first_not_of(" \t\r\n\f\v");
        const auto last = line.find_last_not_of(" \t\r\n\f\v");
        present.insert(first == std::string::npos ? std::string() : line.substr(first, last - first + 1));
    }
    std::vector<std::string> added;
    std::set<std::string> seen;
    for (const std::string& line : wanted) {
        if (!present.contains(line) && seen.insert(line).second) added.push_back(line);
    }
    if (added.empty()) return added;
    const std::string eol = text.find("\r\n") != std::string::npos ? "\r\n" : "\n";
    const std::string lead = text.empty() || text.back() == '\n' ? std::string() : eol;
    std::ofstream out(file, std::ios::binary | std::ios::app);
    if (!out) throw std::runtime_error("cannot write " + file.string());
    out << lead;
    for (const std::string& line : added) out << line << eol;
    return added;
}

void ignore_workspace(Core& core) {
    const ServerSpec& spec = core.spec;
    if (spec.ignore.empty()) return;
    if (!std::filesystem::exists(spec.workspace / ".git")) {
        json::Value fields;
        fields.set("server", spec.name).set("state", "skipped").set("reason", "the workspace is not a git repository").set("ignore", strings_of(spec.ignore));
        announce(core, "gitignore", fields);
        return;
    }
    const std::filesystem::path file = spec.workspace / ".gitignore";
    try {
        const std::vector<std::string> added = add_ignore_lines(file, spec.ignore);
        if (added.empty()) return;
        json::Value fields;
        fields.set("server", spec.name).set("state", "added").set("file", file.string()).set("added", strings_of(added));
        announce(core, "gitignore", fields);
    } catch (const std::exception& err) {
        json::Value fields;
        fields.set("server", spec.name).set("state", "failed").set("file", file.string()).set("error", err.what());
        announce(core, "gitignore", fields);
    }
}

std::shared_ptr<Session> spawn(const std::shared_ptr<Core>& core, std::string& error) {
    proc::SpawnOptions options(core->spec.cwd);
    options.own_group = true;
    options.capture_stderr = true;
    options.env = core->spec.env;
    if (std::none_of(options.env.begin(), options.env.end(), [](const auto& entry) { return entry.first == PROJECT_VARIABLE; }))
        options.env.emplace_back(PROJECT_VARIABLE, core->spec.workspace.string());
    options.env.emplace_back(DEPTH_VARIABLE, std::to_string(core->depth + 1));
    auto spawned = proc::Child::spawn(launch_argv(core->spec), options);
    if (!spawned) {
        error = "MCP server " + core->spec.name + " could not start: " + spawned.error();
        return nullptr;
    }
    auto session = std::make_shared<Session>();
    session->child = *spawned;
    auto transport = std::make_unique<ChildTransport>(core->spec.name, session->child);
    session->transport = transport.get();
    session->client = std::make_unique<mcp::client::Client>(std::move(transport));
    bool accepted = false;
    {
        std::lock_guard lock(core->mutex);
        accepted = !core->closing;
        if (accepted) core->current = session;
    }
    if (!accepted) {
        session->child->close_input();
        session->child->kill();
        error = "MCP server " + core->spec.name + " is stopped by gm";
        return nullptr;
    }
    std::thread(pump, core, session).detach();
    std::thread(drain_errors, core, session).detach();
    return session;
}

std::optional<std::string> list_tools(const std::shared_ptr<Session>& session, std::vector<json::Value>& tools) {
    std::set<std::string> seen;
    std::optional<std::string> cursor;
    for (;;) {
        mcp::protocol::Json params = mcp::protocol::Json::object();
        if (cursor) params["cursor"] = *cursor;
        const auto page = session->client->raw_request(mcp::protocol::make_request("tools/list", std::int64_t{0}, params));
        if (!page) return page.error().message;
        const json::Value listed = from_wire(*page);
        const json::Value* list = listed.find("tools");
        if (list != nullptr && list->is_array()) tools.insert(tools.end(), list->as_array().begin(), list->as_array().end());
        const json::Value* next = listed.find("nextCursor");
        cursor = next != nullptr && next->is_string() && !next->as_string().empty() ? std::optional<std::string>(next->as_string()) : std::nullopt;
        if (!cursor || !seen.insert(*cursor).second) break;
    }
    return std::nullopt;
}

std::optional<std::string> handshake(const std::shared_ptr<Core>& core, const std::shared_ptr<Session>& session, bool again, std::vector<json::Value>& tools) {
    {
        CallBudget budget(std::chrono::milliseconds(core->spec.startup_ms));
        mcp::protocol::Json params = mcp::protocol::Json::object();
        params["protocolVersion"] = std::string(PROTOCOL_VERSIONS[0]);
        params["capabilities"] = mcp::protocol::Json::object();
        params["clientInfo"] = mcp::protocol::Json::object();
        params["clientInfo"]["name"] = CLIENT_NAME;
        params["clientInfo"]["version"] = CLIENT_VERSION;
        const auto raw = session->client->raw_request(mcp::protocol::make_request("initialize", std::int64_t{0}, params));
        if (!raw) {
            if (raw.error().category == "transport") {
                const std::string reason = exit_reason(*session->child);
                if (reason != "exited") return "MCP server " + core->spec.name + " " + reason;
            }
            return raw.error().message;
        }
        const json::Value init = from_wire(*raw);
        if (!init.is_object()) return "initialize result is not an object";
        std::string version = "undefined";
        if (const json::Value* value = init.find("protocolVersion")) version = value->is_string() ? value->as_string() : json::dump(*value);
        if (std::find_if(std::begin(PROTOCOL_VERSIONS), std::end(PROTOCOL_VERSIONS), [&](const char* known) { return version == known; }) ==
            std::end(PROTOCOL_VERSIONS))
            return "protocol version " + version + " is not one gm speaks";
        const json::Value* capabilities = init.find("capabilities");
        if (capabilities == nullptr || !capabilities->is_object()) return "initialize result has no capabilities object";
        const json::Value* server_info = init.find("serverInfo");
        const json::Value* server_version = server_info != nullptr && server_info->is_object() ? server_info->find("version") : nullptr;
        if (server_version == nullptr || !server_version->is_string()) return "initialize result has no serverInfo.version string";
        (void)session->client->notify_initialized();
        if (const auto listed = list_tools(session, tools)) return listed;
        json::Value fields;
        fields.set("server", core->spec.name).set("state", again ? "restarted" : "connected").set("tools", static_cast<std::uint64_t>(tools.size()));
        fields.set("protocolVersion", version);
        announce(*core, "mcp-server", fields);
    }
    ignore_workspace(*core);
    return std::nullopt;
}

}

StdioClient::StdioClient(ServerSpec spec, std::size_t depth, Emit emit) : core_(std::make_shared<Core>()) {
    core_->spec = std::move(spec);
    core_->depth = depth;
    core_->emit = std::move(emit);
}

StdioClient::~StdioClient() { stop(); }

const ServerSpec& StdioClient::spec() const { return core_->spec; }

std::optional<std::string> StdioClient::connect(bool again) {
    std::lock_guard start(start_mutex_);
    if (running(core_)) return std::nullopt;
    if (const std::shared_ptr<Session> old = current(core_)) lose(core_, old, exit_reason(*old->child));
    std::vector<std::string> attempts;
    for (int attempt = 1;; attempt += 1) {
        std::string error;
        const std::shared_ptr<Session> session = spawn(core_, error);
        std::vector<json::Value> tools;
        const std::optional<std::string> problem = session ? handshake(core_, session, again, tools) : std::optional<std::string>(error);
        if (!problem) {
            tools_ = std::move(tools);
            return std::nullopt;
        }
        bool exited = false;
        if (session) {
            std::string reason = "stopped by gm";
            if (const auto code = session->child->wait_for(std::chrono::milliseconds(300))) {
                reason = "exited with code " + std::to_string(*code);
                exited = true;
            }
            lose(core_, session, reason);
            session->child->kill();
        }
        attempts.push_back(*problem);
        if (exited && attempt < STARTUP_ATTEMPTS) {
            json::Value retry;
            retry.set("server", core_->spec.name).set("state", "retrying").set("attempt", static_cast<std::uint64_t>(attempt)).set("error", *problem);
            announce(*core_, "mcp-server", retry);
            continue;
        }
        const std::string message = startup_failure(core_->spec, attempts, stderr_of(*core_));
        json::Value fields;
        fields.set("server", core_->spec.name).set("state", "failed").set("error", message).set("stderr", stderr_of(*core_));
        announce(*core_, "mcp-server", fields);
        return message;
    }
}

void StdioClient::preload_tools(std::vector<json::Value> tools) {
    tools_ = std::move(tools);
    preloaded_ = true;
}

json::Value StdioClient::call_tool(const std::string& tool, const json::Value& args) {
    if (auto error = connect(true)) return failure("MCP server " + core_->spec.name + " is not running: " + *error);
    const std::shared_ptr<Session> session = current(core_);
    if (!session) return failure("MCP server " + core_->spec.name + " is not running");
    mcp::protocol::Json params = mcp::protocol::Json::object();
    params["name"] = tool;
    params["arguments"] = to_wire(args);
    CallBudget budget(std::chrono::milliseconds(core_->spec.timeout_ms));
    const auto reply = session->client->raw_request(mcp::protocol::make_request("tools/call", std::int64_t{0}, params));
    if (!reply) return failure(reply.error().message);
    return outcome_of(from_wire(*reply));
}

void StdioClient::stop() {
    std::shared_ptr<Session> session;
    {
        std::lock_guard lock(core_->mutex);
        core_->closing = true;
        session = core_->current;
    }
    if (!session) return;
    lose(core_, session, "stopped by gm");
    session->child->kill();
}

}
