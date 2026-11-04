#include "gmnew/host/relay.hpp"

#include <algorithm>
#include <cstdio>
#include <iostream>

#include "gmnew/proc.hpp"

#if !defined(_WIN32)
#include <signal.h>
#endif

namespace gmnew::host {

namespace {

constexpr std::string_view kHandshakeId = "gm-new-core-handshake";
constexpr std::string_view kPausedBeforeAnswer =
    "the worker paused before it answered this call; query_log shows what it did, then repeat the call if it did "
    "nothing";
constexpr std::uint64_t kBuildTimeoutMs = 600000;

struct ListKind {
    std::string_view method;
    std::string_view kind;
    std::string_view notice;
};

constexpr ListKind kLists[] = {
    {"tools/list", "tools", "notifications/tools/list_changed"},
    {"prompts/list", "prompts", "notifications/prompts/list_changed"},
    {"resources/list", "resources", "notifications/resources/list_changed"},
};

std::optional<json::Value> parse_message(const std::string& line) {
    auto parsed = json::parse(line);
    if (!parsed || !parsed->is_object()) return std::nullopt;
    return std::move(*parsed);
}

std::optional<std::string> id_key(const json::Value& message) {
    const json::Value* id = message.find("id");
    if (id == nullptr || id->is_null()) return std::nullopt;
    return json::dump(*id);
}

std::string method_of(const json::Value& message) {
    const json::Value* method = message.find("method");
    return method != nullptr && method->is_string() ? method->as_string() : std::string{};
}

std::string error_reply(const std::string& id_json, std::string_view message) {
    return "{\"jsonrpc\":\"2.0\",\"id\":" + id_json + ",\"error\":{\"code\":-32000,\"message\":" + json::quote(message) +
           "}}";
}

bool skipped_directory(const std::filesystem::path& path) {
    const std::string name = path.filename().string();
    return name.empty() || name.front() == '.' || name == "tests";
}

std::string last_lines(const std::string& text, std::size_t max_bytes) {
    return text.size() <= max_bytes ? text : text.substr(text.size() - max_bytes);
}

}  // namespace

Relay::Relay(RelayOptions options, std::function<void(std::string_view)> to_host)
    : options_(std::move(options)), to_host_(std::move(to_host)), retry_delay_(options_.retry_min) {}

Relay::~Relay() {
    bool gone;
    {
        std::lock_guard lock(mutex_);
        gone = host_gone_;
    }
    if (!gone) host_closed();
}

void Relay::say(std::string_view message) {
    if (options_.say) {
        options_.say(message);
        return;
    }
    std::cerr << "gm-new relay: " << message << '\n';
}

void Relay::emit(const std::string& line) {
    std::lock_guard lock(output_mutex_);
    to_host_(line);
}

void Relay::start() {
    sources_changed();
    Lock lock(mutex_);
    if (spawn_worker(lock))
        mark_running(lock);
    else
        fail_with(lock, failure_);
    control_ = std::thread([this] { control_loop(); });
}

bool Relay::spawn_worker(Lock&) {
    auto spawned = Child::spawn(options_.worker_argv, options_.worker_cwd);
    if (!spawned) {
        failure_ = "the worker did not start (" + spawned.error() + ")";
        return false;
    }
    child_ = *spawned;
    child_ended_ = false;
    reader_ = std::thread([this, child = child_] { read_loop(child); });
    return true;
}

void Relay::stop_worker(Lock& lock) {
    std::shared_ptr<Child> child = child_;
    if (!child) return;
    lock.unlock();
    child->close_input();
    child->terminate();
    if (!child->wait_for(options_.stop_grace)) {
        child->kill();
        child->wait_for(std::chrono::milliseconds(2000));
    }
    if (reader_.joinable()) reader_.join();
    lock.lock();
    if (child_ == child) child_.reset();
}

void Relay::mark_running(Lock&) {
    state_ = State::Running;
    retry_delay_ = options_.retry_min;
    retry_at_.reset();
    say("worker running (pid " + std::to_string(child_ ? child_->pid() : -1) + ")");
    changed_.notify_all();
}

void Relay::fail_with(Lock&, const std::string& reason) {
    state_ = State::Failed;
    failure_ = reason;
    for (const auto& [id, method] : inflight_) emit(error_reply(id, failure_));
    inflight_.clear();
    for (const std::string& line : held_) {
        auto message = parse_message(line);
        if (!message) continue;
        auto id = id_key(*message);
        if (id && !method_of(*message).empty()) emit(error_reply(*id, failure_));
    }
    held_.clear();
    retry_at_ = std::chrono::steady_clock::now() + retry_delay_;
    say(reason + "; retrying the worker start in " + std::to_string(retry_delay_.count()) + " ms");
    retry_delay_ = std::min(retry_delay_ * 2, options_.retry_max);
    changed_.notify_all();
}

void Relay::host_line(std::string line) {
    if (line.find_first_not_of(" \t\r") == std::string::npos) return;
    Lock lock(mutex_);
    route_host_line(lock, std::move(line));
}

void Relay::route_host_line(Lock& lock, std::string line) {
    auto message = parse_message(line);
    const std::string method = message ? method_of(*message) : std::string{};
    if (method == "initialize") {
        const json::Value* params = message->find("params");
        host_initialize_ = params != nullptr ? *params : json::Value(json::Object{});
    }
    if (state_ != State::Running) {
        if (state_ == State::Failed) {
            auto id = message ? id_key(*message) : std::nullopt;
            if (id && !method.empty()) emit(error_reply(*id, failure_));
            return;
        }
        held_.push_back(std::move(line));
        return;
    }
    if (message) {
        auto id = id_key(*message);
        if (id && !method.empty()) inflight_[*id] = method;
        if (method == "notifications/cancelled") {
            const json::Value* params = message->find("params");
            const json::Value* request = params != nullptr ? params->find("requestId") : nullptr;
            if (request != nullptr && inflight_.erase(json::dump(*request)) > 0) changed_.notify_all();
        }
    }
    send_to_worker(lock, line);
}

void Relay::send_to_worker(Lock& lock, const std::string& line) {
    std::shared_ptr<Child> child = child_;
    if (!child) return;
    lock.unlock();
    child->write_line(line);
    lock.lock();
}

void Relay::read_loop(std::shared_ptr<Child> child) {
    while (auto line = child->read_line()) {
        if (line->find_first_not_of(" \t\r") == std::string::npos) continue;
        auto message = parse_message(*line);
        Lock lock(mutex_);
        std::string method;
        if (message) {
            if (auto id = id_key(*message)) {
                if (auto waiter = waiters_.find(*id); waiter != waiters_.end()) {
                    waiter->second->reply = std::move(*message);
                    changed_.notify_all();
                    continue;
                }
                if (auto request = inflight_.find(*id); request != inflight_.end()) {
                    const json::Value* result = message->find("result");
                    for (const ListKind& list : kLists) {
                        if (request->second == list.method && result != nullptr)
                            seen_lists_[std::string(list.kind)] = json::dump(*result);
                    }
                    inflight_.erase(request);
                }
            }
            method = method_of(*message);
        }
        const bool list_notice = method.size() >= 12 && method.ends_with("list_changed");
        if (swapping_ && list_notice) continue;
        emit(*line);
        changed_.notify_all();
    }
    Lock lock(mutex_);
    if (child_ != child) return;
    child_ended_ = true;
    changed_.notify_all();
    if (state_ != State::Running && state_ != State::Draining) return;
    lock.unlock();
    const std::optional<int> code = child->wait_for(options_.stop_grace);
    lock.lock();
    if (child_ != child || (state_ != State::Running && state_ != State::Draining)) return;
    if (code && *code == 0) {
        for (const auto& [id, method] : inflight_) emit(error_reply(id, kPausedBeforeAnswer));
        inflight_.clear();
        state_ = State::Restarting;
        pending_restart_ = "the worker paused itself";
        changed_.notify_all();
        return;
    }
    fail_with(lock, "the worker exited unexpectedly (" + (code ? "code " + std::to_string(*code) : std::string("no exit")) +
                        ")");
}

std::optional<json::Value> Relay::ask_worker(Lock& lock, const std::string& id, const std::string& method,
                                             json::Value params, std::chrono::milliseconds timeout) {
    auto waiter = std::make_shared<Waiter>();
    const std::string key = json::quote(id);
    waiters_[key] = waiter;
    json::Value request;
    request.set("jsonrpc", "2.0");
    request.set("id", id);
    request.set("method", method);
    request.set("params", std::move(params));
    send_to_worker(lock, json::dump(request));
    changed_.wait_for(lock, timeout, [&] { return waiter->reply.has_value() || child_ended_; });
    waiters_.erase(key);
    return waiter->reply;
}

bool Relay::replay_handshake(Lock& lock) {
    if (!host_initialize_) return true;
    auto reply = ask_worker(lock, std::string(kHandshakeId), "initialize", *host_initialize_, options_.handshake_timeout);
    if (!reply || reply->find("error") != nullptr) return false;
    send_to_worker(lock, "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}");
    return true;
}

void Relay::announce_changes(Lock& lock) {
    for (const ListKind& list : kLists) {
        auto reply = ask_worker(lock, "gm-new-core:" + std::string(list.method), std::string(list.method),
                                json::Value(json::Object{}), options_.list_timeout);
        if (!reply) continue;
        const json::Value* result = reply->find("result");
        if (result == nullptr) continue;
        auto seen = seen_lists_.find(std::string(list.kind));
        if (seen != seen_lists_.end() && seen->second != json::dump(*result))
            emit("{\"jsonrpc\":\"2.0\",\"method\":\"" + std::string(list.notice) + "\"}");
    }
}

void Relay::flush_held(Lock& lock) {
    std::vector<std::string> lines;
    lines.swap(held_);
    for (std::string& line : lines) route_host_line(lock, std::move(line));
}

void Relay::restart(Lock& lock, const std::string& reason) {
    say("restarting the worker (" + reason + ")");
    if (state_ == State::Running) {
        state_ = State::Draining;
        changed_.wait(lock, [&] { return inflight_.empty() || host_gone_; });
    }
    if (host_gone_) return;
    state_ = State::Restarting;
    swapping_ = true;
    stop_worker(lock);
    if (host_gone_) {
        swapping_ = false;
        return;
    }
    if (!spawn_worker(lock)) {
        swapping_ = false;
        fail_with(lock, failure_);
        return;
    }
    if (!replay_handshake(lock)) {
        swapping_ = false;
        fail_with(lock, "the worker failed to restart (the worker did not answer the handshake)");
        return;
    }
    mark_running(lock);
    ++restarts_;
    announce_changes(lock);
    flush_held(lock);
    swapping_ = false;
}

void Relay::request_restart(std::string reason) {
    std::lock_guard lock(mutex_);
    pending_restart_ = std::move(reason);
    changed_.notify_all();
}

std::optional<std::string> Relay::sources_changed() {
    std::map<std::filesystem::path, std::pair<std::filesystem::file_time_type, std::uintmax_t>> now;
    for (const auto& root : options_.watch_roots) {
        std::error_code ec;
        std::filesystem::recursive_directory_iterator it(root, ec), end;
        for (; !ec && it != end; it.increment(ec)) {
            if (it->is_directory(ec)) {
                if (skipped_directory(it->path())) it.disable_recursion_pending();
                continue;
            }
            if (!it->is_regular_file(ec)) continue;
            now[it->path()] = {it->last_write_time(ec), it->file_size(ec)};
        }
    }
    std::vector<std::string> changed;
    for (const auto& [path, stamp] : now) {
        auto before = source_stamps_.find(path);
        if (before == source_stamps_.end() || before->second != stamp) changed.push_back(path.filename().string());
    }
    for (const auto& [path, stamp] : source_stamps_) {
        if (!now.contains(path)) changed.push_back(path.filename().string());
    }
    const bool first = source_stamps_.empty();
    source_stamps_ = std::move(now);
    if (first || changed.empty()) return std::nullopt;
    std::string names;
    for (const std::string& name : changed) names += (names.empty() ? "" : ", ") + name;
    return names;
}

bool Relay::rebuild(Lock& lock) {
    if (options_.build_dir.empty()) return true;
    lock.unlock();
    const proc::Outcome outcome = proc::run(
        {"cmake", "--build", options_.build_dir.string(), "--target", options_.build_target}, {}, {}, kBuildTimeoutMs);
    lock.lock();
    if (!outcome.started || outcome.timed_out || outcome.exit_code != 0) {
        ++failed_builds_;
        say("the build failed, the old worker keeps serving: " +
            last_lines(outcome.out + outcome.err, 1500));
        return false;
    }
    if (outcome.out.find("no work to do") != std::string::npos) return false;
    return true;
}

void Relay::control_loop() {
    Lock lock(mutex_);
    while (!host_gone_) {
        changed_.wait_for(lock, options_.poll, [&] { return pending_restart_.has_value() || host_gone_; });
        if (host_gone_) break;
        if (pending_restart_) {
            const std::string reason = *pending_restart_;
            pending_restart_.reset();
            restart(lock, reason);
            continue;
        }
        if (state_ == State::Failed && retry_at_ && std::chrono::steady_clock::now() >= *retry_at_) {
            restart(lock, "retry after a failed start");
            continue;
        }
        if (state_ != State::Running) continue;
        lock.unlock();
        auto changed = sources_changed();
        lock.lock();
        if (!changed || host_gone_) continue;
        say("changed: " + *changed);
        if (rebuild(lock) && !host_gone_) restart(lock, "changed: " + *changed);
    }
}

void Relay::host_closed() {
    Lock lock(mutex_);
    if (host_gone_) return;
    host_gone_ = true;
    state_ = State::Stopping;
    changed_.notify_all();
    say("host closed the connection; ending the worker");
    lock.unlock();
    if (control_.joinable()) control_.join();
    lock.lock();
    std::shared_ptr<Child> child = child_;
    lock.unlock();
    if (child) {
        child->close_input();
        if (!child->wait_for(options_.exit_grace)) {
            child->terminate();
            if (!child->wait_for(options_.stop_grace)) {
                child->kill();
                child->wait_for(std::chrono::milliseconds(2000));
            }
        }
    }
    if (reader_.joinable()) reader_.join();
}

std::uint64_t Relay::restarts() const {
    std::lock_guard lock(mutex_);
    return restarts_;
}

std::uint64_t Relay::failed_builds() const {
    std::lock_guard lock(mutex_);
    return failed_builds_;
}

long long Relay::worker_pid() const {
    std::lock_guard lock(mutex_);
    return child_ ? child_->pid() : -1;
}

bool Relay::running() const {
    std::lock_guard lock(mutex_);
    return state_ == State::Running;
}

int serve_stdio(RelayOptions options) {
#if !defined(_WIN32)
    ::signal(SIGPIPE, SIG_IGN);
#endif
    Relay relay(std::move(options), [](std::string_view line) {
        std::fwrite(line.data(), 1, line.size(), stdout);
        std::fputc('\n', stdout);
        std::fflush(stdout);
    });
    relay.start();
    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        relay.host_line(std::move(line));
    }
    relay.host_closed();
    return 0;
}

}  // namespace gmnew::host
