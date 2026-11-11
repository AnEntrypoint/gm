#include "gm/tool.hpp"

#include <chrono>
#include <fstream>
#include <map>
#include <sstream>
#include <system_error>

namespace gm::tool {

Session::Session(const std::string& binary, const std::filesystem::path& workspace, const std::filesystem::path& home,
                 std::uint64_t watchdog_ms, bool quiet) {
    proc::SpawnOptions options(workspace);
    options.own_group = true;
    options.env = {{"HOME", home.string()}};
    std::vector<std::string> argv{binary, "serve", "--workspace", workspace.string(), "--run-dir", (workspace / "runs" / "check").string()};
    if (quiet) {
        argv.push_back("--mcp-config");
        argv.push_back((home / "quiet.json").string());
    }
    auto spawned = proc::Child::spawn(argv, options);
    if (!spawned) return;
    child_ = *spawned;
    watchdog_ = std::thread([this, watchdog_ms] {
        std::unique_lock lock(mutex_);
        if (!done_cv_.wait_for(lock, std::chrono::milliseconds(watchdog_ms), [this] { return done_; })) {
            if (child_) child_->kill();
        }
    });
}

Session::~Session() { stop(); }

void Session::stop() {
    {
        std::lock_guard lock(mutex_);
        done_ = true;
    }
    done_cv_.notify_all();
    if (watchdog_.joinable()) watchdog_.join();
    if (child_) {
        child_->close_input();
        child_->kill();
        child_->wait_for(std::chrono::milliseconds(2000));
        child_.reset();
    }
}

std::vector<long long> Session::descendants() const {
    std::vector<long long> found;
    if (!child_) return found;
    std::map<long long, std::vector<long long>> children;
    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator("/proc", ec)) {
        const std::string name = entry.path().filename().string();
        if (name.empty() || name.find_first_not_of("0123456789") != std::string::npos) continue;
        std::ifstream stat(entry.path() / "stat");
        std::string line;
        std::getline(stat, line);
        const auto close = line.rfind(')');
        if (close == std::string::npos) continue;
        std::istringstream rest(line.substr(close + 2));
        std::string state;
        long long parent = 0;
        rest >> state >> parent;
        children[parent].push_back(std::stoll(name));
    }
    std::vector<long long> frontier{child_->pid()};
    while (!frontier.empty()) {
        const long long current = frontier.back();
        frontier.pop_back();
        for (long long next : children[current]) {
            found.push_back(next);
            frontier.push_back(next);
        }
    }
    return found;
}

void Session::notify(const std::string& method, json::Value params) {
    if (!child_) return;
    json::Value message = json::Object{{"jsonrpc", "2.0"}, {"method", method}, {"params", std::move(params)}};
    child_->write_line(json::dump(message));
}

json::Value Session::rpc(const std::string& method, json::Value params) {
    if (!child_) return nullptr;
    const std::int64_t id = next_id_.fetch_add(1);
    json::Value message = json::Object{{"jsonrpc", "2.0"}, {"id", id}, {"method", method}, {"params", std::move(params)}};
    if (!child_->write_line(json::dump(message))) return nullptr;
    for (;;) {
        auto line = child_->read_line();
        if (!line) return nullptr;
        auto parsed = json::parse(*line);
        if (!parsed) continue;
        const json::Value* reply_id = parsed->find("id");
        if (reply_id && reply_id->is_number() && static_cast<std::int64_t>(reply_id->as_number()) == id) return *parsed;
    }
}

std::string Session::body(const std::string& source) {
    json::Value reply = rpc("tools/call", json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", source}}}});
    const json::Value* result = reply.find("result");
    const json::Value* content = result ? result->find("content") : nullptr;
    if (!content || !content->is_array()) return json::dump(reply);
    std::string text;
    for (const json::Value& block : content->as_array()) {
        const json::Value* part = block.find("text");
        if (!part || !part->is_string()) continue;
        if (!text.empty()) text.push_back('\n');
        text += part->as_string();
    }
    return text.empty() ? json::dump(reply) : text;
}

std::string tool_text(Session& session, const std::string& name, json::Value args) {
    const json::Value reply = session.rpc("tools/call", json::Object{{"name", name}, {"arguments", std::move(args)}});
    const json::Value* result = reply.find("result");
    const json::Value* content = result ? result->find("content") : nullptr;
    if (!content || !content->is_array()) return json::dump(reply);
    std::string text;
    for (const json::Value& block : content->as_array()) {
        const json::Value* part = block.find("text");
        if (!part || !part->is_string()) continue;
        if (!text.empty()) text.push_back('\n');
        text += part->as_string();
    }
    return text.empty() ? json::dump(reply) : text;
}

json::Value tool_json(Session& session, const std::string& name, json::Value args) {
    const std::string text = tool_text(session, name, std::move(args));
    if (auto parsed = json::parse(text)) return *parsed;
    return json::Object{{"ok", false}, {"error", name + " reply was not JSON: " + text.substr(0, 200)}};
}

}
