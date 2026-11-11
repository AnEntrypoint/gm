#include "gm/tool.hpp"

#include <chrono>

namespace gm::tool {

Session::Session(const std::string& binary, const std::filesystem::path& workspace, const std::filesystem::path& home,
                 std::uint64_t watchdog_ms) {
    proc::SpawnOptions options(workspace);
    options.own_group = true;
    options.env = {{"HOME", home.string()}};
    const std::vector<std::string> argv{binary,           "serve",
                                        "--workspace",    workspace.string(),
                                        "--run-dir",      (workspace / "runs" / "check").string(),
                                        "--mcp-config",   (home / "quiet.json").string()};
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

}
