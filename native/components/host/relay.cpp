#include "gm/host/relay.hpp"

#include <algorithm>
#include <chrono>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <iostream>

#include "gm/clock.hpp"
#include "gm/proc.hpp"

#if !defined(_WIN32)
#include <poll.h>
#include <signal.h>
#include <unistd.h>
#endif

namespace gm::host {

namespace {

constexpr std::string_view kHandshakeId = "gm-core-handshake";
constexpr std::string_view kGmSkillUri = "skill://gm/SKILL.md";
constexpr std::string_view kPausedBeforeAnswer =
    "the worker paused before it answered this call; query_log shows what it did, then repeat the call if it did "
    "nothing";
constexpr std::string_view kRestartedBeforeAnswer =
    "the worker restarted before it answered this call; the call may be retried";
constexpr std::uint64_t kBuildTimeoutMs = 600000;
constexpr std::chrono::milliseconds kUpdateRetryWait{600000};

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

constexpr std::string_view kBodiesMethod = "gm/bodies";

std::uint64_t bodies_running(const json::Value& message) {
    const json::Value* params = message.find("params");
    const json::Value* running = params != nullptr ? params->find("running") : nullptr;
    return running != nullptr && running->is_number() ? static_cast<std::uint64_t>(running->as_number()) : 0;
}

bool resendable_call(const json::Value& message) {
    if (method_of(message) != "tools/call") return false;
    const json::Value* params = message.find("params");
    const json::Value* name = params != nullptr ? params->find("name") : nullptr;
    return name != nullptr && name->is_string() && name->as_string() == "next_context";
}

constexpr std::uint64_t kStartCheckMs = 20000;

bool build_starts(const std::filesystem::path& dir) {
    for (const std::string& name : {executable_name(), core_executable_name()}) {
        const gm::proc::Outcome outcome = gm::proc::run({(dir / name).string(), "--version"}, {}, {}, kStartCheckMs);
        if (!outcome.started || outcome.timed_out || outcome.exit_code != 0 || outcome.out.empty()) return false;
    }
    return true;
}

std::string build_notice(const std::string& from, const std::string& to) {
    json::Value params(json::Object{});
    params.set("level", "notice");
    params.set("logger", "gm");
    params.set("data", "gm build changed from " + from + " to " + to + "; this session now runs " + to + ", and its run carries over");
    json::Value message(json::Object{});
    message.set("jsonrpc", "2.0");
    message.set("method", "notifications/message");
    message.set("params", std::move(params));
    return json::dump(message);
}

std::string error_reply(const std::string& id_json, std::string_view message) {
    return "{\"jsonrpc\":\"2.0\",\"id\":" + id_json + ",\"error\":{\"code\":-32000,\"message\":" + json::quote(message) +
           "}}";
}

std::optional<SourceStamp> stamp_of(const std::filesystem::path& path) {
    std::error_code ec;
    if (!std::filesystem::is_regular_file(path, ec)) return std::nullopt;
    return SourceStamp{std::filesystem::last_write_time(path, ec), std::filesystem::file_size(path, ec)};
}

bool skipped_directory(const std::filesystem::path& path) {
    const std::string name = path.filename().string();
    return name.empty() || name.front() == '.' || name == "tests";
}

std::string last_lines(const std::string& text, std::size_t max_bytes) {
    return text.size() <= max_bytes ? text : text.substr(text.size() - max_bytes);
}

#if !defined(_WIN32)
void pump_host_stdin(Relay& relay) {
    std::string buffer;
    char chunk[65536];
    for (;;) {
        if (buffer.empty()) relay.reexec();
        pollfd input{0, POLLIN, 0};
        if (::poll(&input, 1, 200) < 0) {
            if (errno == EINTR) continue;
            return;
        }
        if (input.revents == 0) continue;
        const ssize_t count = ::read(0, chunk, sizeof chunk);
        if (count < 0) {
            if (errno == EINTR || errno == EAGAIN) continue;
            return;
        }
        if (count == 0) {
            if (!buffer.empty()) relay.host_line(std::move(buffer));
            return;
        }
        buffer.append(chunk, static_cast<std::size_t>(count));
        for (std::size_t end = buffer.find('\n'); end != std::string::npos; end = buffer.find('\n')) {
            std::string line = buffer.substr(0, end);
            buffer.erase(0, end + 1);
            if (!line.empty() && line.back() == '\r') line.pop_back();
            relay.host_line(std::move(line));
        }
    }
}
#endif

}

Relay::Relay(RelayOptions options, std::function<void(std::string_view)> to_host)
    : options_(std::move(options)), to_host_(std::move(to_host)), retry_delay_(options_.retry_min) {
    host_initialize_ = options_.initialize;
    skill_read_ = options_.skill_read;
    if (!options_.from_build.empty() && options_.from_build != kBuildVersion)
        handover_reason_ = "build " + options_.from_build + " -> " + std::string(kBuildVersion);
}

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
    std::cerr << "gm relay: " << message << '\n';
}

void Relay::emit(const std::string& line) {
    std::lock_guard lock(output_mutex_);
    to_host_(line);
}

void Relay::start() {
    sources_changed(restart_roots(), source_stamps_);
    sources_changed(options_.build_roots, build_stamps_);
    Lock lock(mutex_);
    if (!spawn_worker(lock))
        fail_with(lock, failure_);
    else if (!replay_handshake(lock))
        fail_with(lock, "the worker did not answer the handshake");
    else {
        mark_running(lock);
        for (std::string& line : options_.resend) route_host_line(lock, std::move(line));
        options_.resend.clear();
    }
    control_ = std::thread([this] { control_loop(); });
    if (options_.update && (options_.update->enabled || install_root_of(options_.update->install_dir))) updater_ = std::thread([this] { update_loop(); });
    if (options_.update && install_root_of(options_.update->install_dir)) watcher_ = std::thread([this] { watch_install_loop(); });
}

bool Relay::spawn_worker(Lock&) {
    std::vector<std::string> argv = options_.worker_argv;
    if (!handover_reason_.empty()) {
        argv.insert(argv.end(), {"--restart-reason", handover_reason_});
        handover_reason_.clear();
    }
    auto spawned = Child::spawn(argv, options_.worker_cwd);
    if (!spawned) {
        failure_ = "the worker did not start (" + spawned.error() + ")";
        return false;
    }
    child_ = *spawned;
    child_ended_ = false;
    bodies_running_ = 0;
    body_wait_said_ = false;
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
    resendable_.clear();
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
    if (method == "resources/read") {
        const json::Value* params = message->find("params");
        const json::Value* uri = params != nullptr ? params->find("uri") : nullptr;
        if (uri != nullptr && uri->is_string() && uri->as_string() == kGmSkillUri) skill_read_ = true;
    }
    if (method == "prompts/get" || method == "tools/call") {
        const json::Value* params = message->find("params");
        const json::Value* name = params != nullptr ? params->find("name") : nullptr;
        const std::string_view delivers_skill = method == "prompts/get" ? "gm" : "run_code";
        if (name != nullptr && name->is_string() && name->as_string() == delivers_skill) skill_read_ = true;
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
        if (id && !method.empty()) {
            inflight_[*id] = method;
            if (resendable_call(*message)) resendable_[*id] = line;
            else resendable_.erase(*id);
        }
        if (method == "notifications/cancelled") {
            const json::Value* params = message->find("params");
            const json::Value* request = params != nullptr ? params->find("requestId") : nullptr;
            if (request != nullptr) {
                resendable_.erase(json::dump(*request));
                if (inflight_.erase(json::dump(*request)) > 0) changed_.notify_all();
            }
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
                resendable_.erase(*id);
            }
            method = method_of(*message);
            if (method == kBodiesMethod) {
                bodies_running_ = bodies_running(*message);
                if (bodies_running_ == 0) body_wait_said_ = false;
                changed_.notify_all();
                continue;
            }
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
        auto reply = ask_worker(lock, "gm-core:" + std::string(list.method), std::string(list.method),
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

std::vector<std::filesystem::path> Relay::restart_roots() const {
    std::vector<std::filesystem::path> roots = options_.runtime_roots;
    roots.push_back(binary());
    return roots;
}

std::filesystem::path Relay::binary() const {
    return options_.worker_argv.empty() ? std::filesystem::path{} : std::filesystem::path(options_.worker_argv.front());
}

bool Relay::binary_settled(Lock& lock) {
    const auto before = stamp_of(binary());
    lock.unlock();
    std::this_thread::sleep_for(options_.settle);
    lock.lock();
    const auto after = stamp_of(binary());
    if (before != after) return false;
    if (auto known = source_stamps_.find(binary()); known != source_stamps_.end() && after) known->second = *after;
    return true;
}

void Relay::restart(Lock& lock, const std::string& reason) {
    if (!binary_settled(lock)) {
        if (!deferred_restart_) say("the worker binary is still being written; the restart waits for it to settle");
        deferred_restart_ = true;
        pending_restart_ = reason;
        return;
    }
    deferred_restart_ = false;
    say("restarting the worker (" + reason + ")");
    if (state_ == State::Running) {
        state_ = State::Draining;
        changed_.wait_for(lock, options_.drain_timeout, [&] { return only_resendable_in_flight() || host_gone_; });
    }
    if (host_gone_) return;
    state_ = State::Restarting;
    swapping_ = true;
    stop_worker(lock);
    std::map<std::string, std::string> resend;
    std::vector<std::string> replay;
    for (const auto& [id, method] : inflight_) {
        auto found = resendable_.find(id);
        if (found != resendable_.end()) {
            resend.emplace(id, method);
            replay.push_back(found->second);
        } else {
            emit(error_reply(id, kRestartedBeforeAnswer));
        }
    }
    inflight_ = std::move(resend);
    if (host_gone_) {
        swapping_ = false;
        return;
    }
    handover_reason_ = reason;
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
    for (const std::string& line : replay) send_to_worker(lock, line);
    flush_held(lock);
    swapping_ = false;
}

void Relay::request_restart(std::string reason) {
    std::lock_guard lock(mutex_);
    pending_restart_ = std::move(reason);
    changed_.notify_all();
}

bool Relay::only_resendable_in_flight() const {
    return std::all_of(inflight_.begin(), inflight_.end(), [&](const auto& call) { return resendable_.contains(call.first); });
}

void Relay::reexec() {
#if !defined(_WIN32)
    Lock lock(mutex_);
    auto calls_settled = [&] { return reexec_pending_ && !options_.reexec_argv.empty() && state_ == State::Running && only_resendable_in_flight() && !swapping_ && !host_gone_; };
    auto ready = [&] { return calls_settled() && bodies_running_ == 0; };
    if (!ready()) {
        if (calls_settled() && bodies_running_ > 0 && !body_wait_said_) {
            body_wait_said_ = true;
            say("re-executing waits for " + std::to_string(bodies_running_) + " running body job(s); it follows when they end");
        }
        return;
    }
    std::error_code canonical_error;
    const std::filesystem::path build_dir = std::filesystem::canonical(options_.reexec_argv.front(), canonical_error).parent_path();
    const std::string stamp = build_dir.filename().string();
    if (canonical_error || stamp == refused_build_) {
        reexec_pending_ = false;
        return;
    }
    lock.unlock();
    const bool starts = build_starts(build_dir);
    lock.lock();
    if (!ready()) return;
    if (!starts) {
        reexec_pending_ = false;
        refused_build_ = stamp;
        say("refused build " + stamp + ": its start check failed; this run stays on " + std::string(kBuildVersion));
        return;
    }
    reexec_pending_ = false;
    state_ = State::Restarting;
    say("re-executing the relay on the new build");
    emit(build_notice(std::string(kBuildVersion), stamp));
    stop_worker(lock);
    std::vector<std::string> argv = options_.reexec_argv;
    json::Array carried;
    for (const auto& [id, method] : inflight_) {
        if (auto line = resendable_.find(id); line != resendable_.end()) carried.emplace_back(line->second);
    }
    if (!carried.empty()) {
        say("carrying " + std::to_string(carried.size()) + " waiting next_context call(s) to the new relay");
        argv.emplace_back("--resend");
        argv.push_back(json::dump(json::Value(std::move(carried))));
    }
    if (options_.update && !install_root_of(options_.update->install_dir)) {
        const std::filesystem::path installed = options_.update->install_dir / executable_name();
        std::error_code ec;
        if (std::filesystem::exists(installed, ec)) argv.front() = installed.string();
    }
    if (host_initialize_) {
        argv.emplace_back("--handshake");
        argv.push_back(json::dump(*host_initialize_));
    }
    if (skill_read_) argv.insert(argv.end(), {"--skill-read", "yes"});
    argv.insert(argv.end(), {"--from-build", std::string(kBuildVersion)});
    std::vector<char*> arguments;
    for (std::string& argument : argv) arguments.push_back(argument.data());
    arguments.push_back(nullptr);
    lock.unlock();
    cancel_download();
    {
        std::lock_guard out(output_mutex_);
        std::fflush(stdout);
        ::execv(argv.front().c_str(), arguments.data());
    }
    lock.lock();
    fail_with(lock, std::string("the relay could not re-execute (") + std::strerror(errno) + ")");
#endif
}

namespace {

const std::chrono::milliseconds kInstallPoll{static_cast<std::int64_t>(2000 * clock_scale())};

bool installed_elsewhere(const UpdatePolicy& policy) {
    const auto root = install_root_of(policy.install_dir);
    if (!root) return false;
    const std::string linked = linked_version(*root);
    return !linked.empty() && linked != policy.install_dir.filename().string();
}

}

void Relay::update_loop() {
    UpdatePolicy policy = *options_.update;
    Lock lock(mutex_);
    while (!host_gone_) {
        lock.unlock();
        UpdateResult result;
        result.ok = true;
        if (policy.enabled) result = update_now(policy);
#if defined(_WIN32)
        if (result.updated) policy.current_version = result.to;
#endif
        const std::chrono::milliseconds wait = !policy.enabled ? kInstallPoll : result.ok ? std::max(next_check_delay(policy), kUpdateRetryWait) : kUpdateRetryWait;
        lock.lock();
        if (host_gone_) break;
        if (!result.ok) {
            say("update skipped: " + result.error);
        } else if (result.status.starts_with("kept") || result.status.starts_with("refused")) {
            say(result.status);
        } else if (result.updated) {
            say("updated " + result.from + " -> " + result.to);
#if defined(_WIN32)
            say("the relay keeps the previous build until it restarts; the worker runs the new build");
#else
            reexec_pending_ = true;
#endif
            changed_.notify_all();
        }
        const auto deadline = std::chrono::steady_clock::now() + wait;
        changed_.wait_until(lock, deadline, [&] { return host_gone_; });
    }
}

void Relay::watch_install_loop() {
    const UpdatePolicy policy = *options_.update;
    std::string handled;
    Lock lock(mutex_);
    while (!host_gone_) {
        changed_.wait_for(lock, kInstallPoll, [&] { return host_gone_; });
        if (host_gone_ || !installed_elsewhere(policy)) continue;
        const std::string linked = linked_version(*install_root_of(policy.install_dir));
        if (linked == handled) continue;
        handled = linked;
        say("the install now points at " + linked + "; re-executing on it");
        reexec_pending_ = true;
        changed_.notify_all();
    }
}

std::optional<std::string> Relay::sources_changed(const std::vector<std::filesystem::path>& roots, SourceStamps& stamps) {
    SourceStamps now;
    for (const auto& root : roots) {
        if (auto file = stamp_of(root)) {
            now[root] = *file;
            continue;
        }
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
        auto before = stamps.find(path);
        if (before == stamps.end() || before->second != stamp) changed.push_back(path.filename().string());
    }
    for (const auto& [path, stamp] : stamps) {
        if (!now.contains(path)) changed.push_back(path.filename().string());
    }
    const bool first = stamps.empty();
    stamps = std::move(now);
    if (first || changed.empty()) return std::nullopt;
    std::string names;
    for (const std::string& name : changed) names += (names.empty() ? "" : ", ") + name;
    return names;
}

void Relay::rebuild(Lock& lock) {
    if (options_.build_dir.empty()) return;
    lock.unlock();
    const proc::Outcome outcome = proc::run(
        {"cmake", "--build", options_.build_dir.string(), "--target", options_.build_target, "gm-core"}, {}, {}, kBuildTimeoutMs);
    lock.lock();
    if (!outcome.started || outcome.timed_out || outcome.exit_code != 0) {
        ++failed_builds_;
        say("the build failed, the old worker keeps serving: " + last_lines(outcome.out + outcome.err, 1500));
    }
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
        auto built = sources_changed(options_.build_roots, build_stamps_);
        lock.lock();
        if (built && !host_gone_) {
            say("changed: " + *built);
            rebuild(lock);
        }
        if (state_ != State::Running || host_gone_) continue;
        lock.unlock();
        auto changed = sources_changed(restart_roots(), source_stamps_);
        lock.lock();
        if (!changed || host_gone_) continue;
        say("changed: " + *changed);
        restart(lock, "changed: " + *changed);
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
    cancel_download();
    if (updater_.joinable()) updater_.join();
    if (watcher_.joinable()) watcher_.join();
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
#if defined(_WIN32)
    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        relay.host_line(std::move(line));
    }
#else
    pump_host_stdin(relay);
#endif
    relay.host_closed();
    return 0;
}

}
