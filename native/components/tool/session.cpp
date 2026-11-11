#include "gm/tool.hpp"

#include <chrono>
#include <fstream>
#include <map>
#include <sstream>
#include <system_error>

namespace gm::tool {

Session::Session(const std::string& binary, const std::filesystem::path& workspace, const std::filesystem::path& home,
                 std::uint64_t watchdog_ms, bool quiet, std::vector<std::string> extra) {
    std::vector<std::string> argv{binary, "serve", "--workspace", workspace.string(), "--run-dir", (workspace / "runs" / "check").string()};
    if (quiet) {
        argv.push_back("--mcp-config");
        argv.push_back((home / "quiet.json").string());
    }
    argv.insert(argv.end(), extra.begin(), extra.end());
    start(argv, workspace, home, watchdog_ms);
}

Session::Session(std::vector<std::string> argv, const std::filesystem::path& workspace, const std::filesystem::path& home, std::uint64_t watchdog_ms) {
    start(argv, workspace, home, watchdog_ms);
}

void Session::start(const std::vector<std::string>& argv, const std::filesystem::path& workspace, const std::filesystem::path& home, std::uint64_t watchdog_ms) {
    proc::SpawnOptions options(workspace);
    options.own_group = true;
    options.capture_stderr = true;
    options.env = {{"HOME", home.string()}};
    auto spawned = proc::Child::spawn(argv, options);
    if (!spawned) return;
    child_ = *spawned;
    inbox_ = std::make_shared<Inbox>();
    std::thread([child = child_, inbox = inbox_] {
        for (;;) {
            auto chunk = child->read_error_chunk();
            if (!chunk) break;
            std::lock_guard lock(inbox->mutex);
            inbox->errors += *chunk;
        }
    }).detach();
    std::thread([child = child_, inbox = inbox_] {
        for (;;) {
            auto line = child->read_line();
            if (!line) break;
            auto parsed = json::parse(*line);
            std::lock_guard lock(inbox->mutex);
            if (!parsed) {
                inbox->strays.push_back(*line);
                continue;
            }
            const json::Value* id = parsed->find("id");
            if (!id || !id->is_number()) {
                if (parsed->find("method")) inbox->notes.push_back(*parsed);
                continue;
            }
            inbox->replies[static_cast<std::int64_t>(id->as_number())] = *parsed;
            inbox->cv.notify_all();
        }
        std::lock_guard lock(inbox->mutex);
        inbox->closed = true;
        inbox->cv.notify_all();
    }).detach();
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

std::int64_t Session::send(const std::string& method, json::Value params) {
    if (!child_) return -1;
    const std::int64_t id = next_id_.fetch_add(1);
    json::Value message = json::Object{{"jsonrpc", "2.0"}, {"id", id}, {"method", method}, {"params", std::move(params)}};
    if (!child_->write_line(json::dump(message))) return -1;
    return id;
}

std::string Session::stderr_text() const {
    if (!inbox_) return {};
    std::lock_guard lock(inbox_->mutex);
    return inbox_->errors;
}

long long Session::pid() const { return child_ ? child_->pid() : -1; }

std::vector<std::string> Session::stray_lines() const {
    if (!inbox_) return {};
    std::lock_guard lock(inbox_->mutex);
    return inbox_->strays;
}

std::vector<json::Value> Session::notes() const {
    if (!inbox_) return {};
    std::lock_guard lock(inbox_->mutex);
    return inbox_->notes;
}

std::optional<json::Value> Session::await_reply(std::int64_t id, std::chrono::milliseconds wait) {
    if (!inbox_) return std::nullopt;
    std::unique_lock lock(inbox_->mutex);
    inbox_->cv.wait_for(lock, wait, [&] { return inbox_->replies.count(id) > 0 || inbox_->closed; });
    const auto found = inbox_->replies.find(id);
    if (found == inbox_->replies.end()) return std::nullopt;
    json::Value reply = found->second;
    inbox_->replies.erase(found);
    return reply;
}

json::Value Session::rpc(const std::string& method, json::Value params) {
    const std::int64_t id = send(method, std::move(params));
    if (id < 0) return nullptr;
    const auto reply = await_reply(id, std::chrono::hours(24));
    return reply ? *reply : json::Value();
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
    const json::Value reply = session.rpc("tools/call", json::Object{{"name", name}, {"arguments", std::move(args)}});
    const json::Value* result = reply.find("result");
    const json::Value* content = result ? result->find("content") : nullptr;
    const json::Value* first = content && content->is_array() && !content->as_array().empty() ? content->as_array().front().find("text") : nullptr;
    const std::string text = first && first->is_string() ? first->as_string() : json::dump(reply);
    auto parsed = json::parse(text);
    if (!parsed) return json::Object{{"ok", false}, {"error", name + " reply was not JSON: " + text.substr(0, 200)}};
    json::Value envelope = *parsed;
    const json::Value* output = envelope.find("output");
    const bool placeholder = output != nullptr && output->is_string() && output->as_string() == "[the output is the text block after this one]";
    if (placeholder && content->as_array().size() > 1) {
        const json::Value* second = content->as_array()[1].find("text");
        const std::string value = second != nullptr && second->is_string() ? second->as_string() : std::string();
        if (auto value_json = json::parse(value)) envelope.set("output", *value_json);
        else envelope.set("output", value);
    }
    return envelope;
}

std::vector<json::Value> run_events(const std::filesystem::path& log, const std::string& kind) {
    std::vector<json::Value> events;
    std::ifstream in(log);
    std::string line;
    while (std::getline(in, line)) {
        auto parsed = json::parse(line);
        if (!parsed) continue;
        const json::Value* found = parsed->find("kind");
        if (found != nullptr && found->is_string() && found->as_string() == kind) events.push_back(*parsed);
    }
    return events;
}

json::Value output_value(const json::Value& reply) {
    const json::Value* output = reply.find("output");
    if (output == nullptr) return json::Value();
    if (output->is_string()) {
        if (auto parsed = json::parse(output->as_string())) return *parsed;
    }
    return *output;
}

const json::Value* value_at(const json::Value& value, const std::string& dotted) {
    const json::Value* at = &value;
    std::size_t start = 0;
    while (start <= dotted.size()) {
        const std::size_t dot = dotted.find('.', start);
        const std::string key = dotted.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
        at = at->find(key);
        if (at == nullptr) return nullptr;
        if (dot == std::string::npos) break;
        start = dot + 1;
    }
    return at;
}

std::string text_at(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_string() ? found->as_string() : std::string();
}

}
