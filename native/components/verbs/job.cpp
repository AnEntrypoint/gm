#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstring>
#include <fstream>
#include <system_error>
#include <vector>

#include "core_internal.hpp"

#if !defined(_WIN32)
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
#endif

namespace gmnew::core {

namespace {

constexpr std::uint64_t kill_grace_ms = 500;
constexpr double max_wait_ms = 30000;

bool is_job_name(const json::Value* v) {
    if (v == nullptr || !v->is_string()) return false;
    const std::string& name = v->as_string();
    if (name.empty() || name.size() > 64) return false;
    return std::all_of(name.begin(), name.end(), [](char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    });
}

double steady_ms() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

double round_mono(double ms) { return std::round(ms * 1000) / 1000; }

std::string read_bytes(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    return to_valid_utf8(std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>()));
}

#if !defined(_WIN32)

const char* signal_name(int signal_number) {
    switch (signal_number) {
        case SIGHUP: return "SIGHUP";
        case SIGINT: return "SIGINT";
        case SIGQUIT: return "SIGQUIT";
        case SIGILL: return "SIGILL";
        case SIGTRAP: return "SIGTRAP";
        case SIGABRT: return "SIGABRT";
        case SIGBUS: return "SIGBUS";
        case SIGFPE: return "SIGFPE";
        case SIGKILL: return "SIGKILL";
        case SIGUSR1: return "SIGUSR1";
        case SIGSEGV: return "SIGSEGV";
        case SIGUSR2: return "SIGUSR2";
        case SIGPIPE: return "SIGPIPE";
        case SIGALRM: return "SIGALRM";
        case SIGTERM: return "SIGTERM";
        default: return nullptr;
    }
}

void kill_group(int pid) {
    if (::kill(-pid, SIGTERM) != 0) return;
    std::thread([pid] {
        std::this_thread::sleep_for(std::chrono::milliseconds(kill_grace_ms));
        ::kill(-pid, SIGKILL);
    }).detach();
}

void kill_group_now(int pid) { ::kill(-pid, SIGKILL); }

struct Spawned {
    int pid = -1;
    std::string error;
};

Spawned spawn_shell_job(const std::string& command, const std::filesystem::path& cwd, const std::filesystem::path& out) {
    Spawned result;
    std::vector<std::string> env_strings;
    for (char** entry = environ; entry != nullptr && *entry != nullptr; ++entry) {
        std::string_view text(*entry);
        if (text.starts_with("ANTHROPIC_API_KEY=")) continue;
        env_strings.emplace_back(text);
    }
    std::vector<char*> envp;
    for (auto& s : env_strings) envp.push_back(s.data());
    envp.push_back(nullptr);

    std::string shell = "/bin/sh";
    std::string dash_c = "-c";
    std::string line = command;
    char* argv[] = {shell.data(), dash_c.data(), line.data(), nullptr};

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
    posix_spawn_file_actions_addopen(&actions, 1, out.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
    posix_spawn_file_actions_adddup2(&actions, 1, 2);
    posix_spawn_file_actions_addchdir_np(&actions, cwd.c_str());
    posix_spawnattr_t attributes;
    posix_spawnattr_init(&attributes);
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP);
    posix_spawnattr_setpgroup(&attributes, 0);
    pid_t pid = -1;
    int rc = posix_spawn(&pid, shell.c_str(), &actions, &attributes, argv, envp.data());
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attributes);
    if (rc != 0) {
        result.error = "spawn /bin/sh " + std::string(std::strerror(rc));
        return result;
    }
    result.pid = static_cast<int>(pid);
    return result;
}

#endif

}  // namespace

struct JobTable::Job {
    std::string name;
    int pid = -1;
    std::filesystem::path out;
    json::Value status;
    double start_mono = 0;
    bool settled = false;
    bool kill_requested = false;
    bool lifetime_killed = false;
    std::optional<std::string> kill_reason;
    std::thread waiter;
    std::thread timer;
};

JobTable::JobTable(std::filesystem::path workspace, LockedLog& log, std::uint64_t lifetime_ms)
    : workspace_(std::move(workspace)), log_(log), lifetime_ms_(lifetime_ms) {}

JobTable::~JobTable() {
    close("run-ended");
    for (auto& [name, job] : jobs_) {
        if (job->waiter.joinable()) job->waiter.join();
        if (job->timer.joinable()) job->timer.join();
    }
}

double JobTable::mono_now() { return round_mono(*mono_offset_ + steady_ms()); }

void JobTable::write_status(const std::string& name, const json::Value& status) {
    auto file = jobs_dir() / (name + ".json");
#if defined(_WIN32)
    auto temp = file;
    temp += ".tmp";
#else
    auto temp = file;
    temp += "." + std::to_string(::getpid()) + ".tmp";
#endif
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        out << json::dump(status) << '\n';
    }
    std::error_code ec;
    std::filesystem::rename(temp, file, ec);
}

std::optional<json::Value> JobTable::read_status(const std::string& name) {
    auto file = jobs_dir() / (name + ".json");
    std::ifstream in(file, std::ios::binary);
    if (!in) return std::nullopt;
    std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    auto parsed = json::parse(text);
    if (!parsed) return std::nullopt;
    return std::move(*parsed);
}

json::Value JobTable::start(const std::string& name, const std::string& command, std::uint64_t timeout_ms) {
#if defined(_WIN32)
    (void)name;
    (void)command;
    (void)timeout_ms;
    return failure("job_start is not available on Windows in the native build yet");
#else
    std::unique_lock lock(mutex_);
    if (jobs_.contains(name)) return failure("job " + name + " already exists");
    std::error_code ec;
    std::filesystem::create_directories(jobs_dir(), ec);
    auto out = jobs_dir() / (name + ".out");
    { std::ofstream create(out, std::ios::binary | std::ios::trunc); }
    std::optional<double> start_mono;
    if (mono_offset_) start_mono = mono_now();
    Spawned spawned = spawn_shell_job(command, workspace_, out);
    if (spawned.pid < 0) return failure(spawned.error);

    json::Value running;
    running.set("job", name);
    running.set("state", "running");
    running.set("pid", spawned.pid);
    std::uint64_t seq = log_.append("job", std::move(running));
    if (!start_mono) {
        double mono = 0;
        if (auto events = log_.read_all()) {
            for (auto it = events->rbegin(); it != events->rend(); ++it) {
                const json::Value* s = it->find("seq");
                if (s != nullptr && s->as_number() == static_cast<double>(seq)) {
                    if (const json::Value* m = it->find("mono")) mono = m->as_number();
                    break;
                }
            }
        }
        mono_offset_ = mono - steady_ms();
        start_mono = mono;
    }

    auto job = std::make_unique<Job>();
    job->name = name;
    job->pid = spawned.pid;
    job->out = out;
    job->start_mono = *start_mono;
    job->lifetime_killed = lifetime_ms_ < timeout_ms;
    job->status.set("job", name);
    job->status.set("command", command);
    job->status.set("state", "running");
    job->status.set("pid", spawned.pid);
    job->status.set("startMono", *start_mono);
    job->status.set("output", out.string());
    write_status(name, job->status);

    Job& ref = *job;
    jobs_.emplace(name, std::move(job));
    std::uint64_t deadline_ms = std::min(timeout_ms, lifetime_ms_);
    ref.waiter = std::thread([this, &ref] {
        int raw = 0;
        while (::waitpid(ref.pid, &raw, 0) < 0 && errno == EINTR) {
        }
        if (WIFEXITED(raw)) {
            settle(ref, WEXITSTATUS(raw), nullptr);
        } else if (WIFSIGNALED(raw)) {
            const char* signal_text = signal_name(WTERMSIG(raw));
            settle(ref, std::nullopt, signal_text != nullptr ? json::Value(signal_text) : json::Value(WTERMSIG(raw)));
        } else {
            settle(ref, std::nullopt, nullptr);
        }
    });
    ref.timer = std::thread([this, &ref, deadline_ms] { watch(ref, deadline_ms); });

    json::Value reply;
    reply.set("ok", true);
    reply.set("state", "running");
    reply.set("output", "started job " + name + " (pid " + std::to_string(spawned.pid) + ")");
    return reply;
#endif
}

void JobTable::watch(Job& job, std::uint64_t deadline_ms) {
#if !defined(_WIN32)
    std::unique_lock lock(mutex_);
    if (changed_.wait_for(lock, std::chrono::milliseconds(deadline_ms), [&] { return job.settled; })) return;
    job.kill_requested = true;
    if (job.lifetime_killed) job.kill_reason = "lifetime";
    int pid = job.pid;
    lock.unlock();
    kill_group(pid);
#else
    (void)job;
    (void)deadline_ms;
#endif
}

void JobTable::settle(Job& job, std::optional<int> exit_code, json::Value signal) {
    std::unique_lock lock(mutex_);
    if (job.settled) return;
    bool exited = exit_code.has_value() && !job.kill_requested;
    std::string state = exited ? "exited" : "killed";
    std::optional<std::string> reason = exited ? std::nullopt : job.kill_reason;
    json::Value exit_value = exit_code ? json::Value(*exit_code) : json::Value(nullptr);

    json::Value ended = job.status;
    ended.set("state", state);
    ended.set("exitCode", exit_value);
    ended.set("signal", signal);
    if (reason) ended.set("reason", *reason);
    write_status(job.name, ended);

    json::Value event;
    event.set("job", job.name);
    event.set("state", state);
    event.set("exitCode", exit_value);
    event.set("signal", signal);
    event.set("startMono", job.start_mono);
    if (reason) event.set("reason", *reason);
    log_.append("job", std::move(event));
    if (job.kill_reason) {
        json::Value killed;
        killed.set("job", job.name);
        killed.set("reason", *job.kill_reason);
        if (*job.kill_reason == "lifetime") killed.set("lifetimeMs", static_cast<std::uint64_t>(lifetime_ms_));
        killed.set("tail", utf16_tail(read_bytes(job.out), tail_cap));
        log_.append("job-killed", std::move(killed));
    }
    job.settled = true;
    changed_.notify_all();
}

json::Value JobTable::status(const json::Value& args) {
    const json::Value* name_value = args.find("job");
    if (!is_job_name(name_value)) return failure("job must be a job name");
    const std::string& name = name_value->as_string();
    double wait_ms = 0;
    if (const json::Value* w = args.find("waitMs"); w != nullptr && w->is_number() && std::isfinite(w->as_number())) {
        wait_ms = std::clamp(w->as_number(), 0.0, max_wait_ms);
    }
    {
        std::unique_lock lock(mutex_);
        auto found = jobs_.find(name);
        if (found != jobs_.end() && !found->second->settled && wait_ms > 0) {
            Job& job = *found->second;
            changed_.wait_for(lock, std::chrono::duration<double, std::milli>(wait_ms), [&] { return job.settled; });
        }
    }
    auto status = read_status(name);
    if (!status) return failure("no job named " + name);
    const json::Value* offset_value = present(args, "offset");
    if (offset_value != nullptr && (!is_whole_number(offset_value) || offset_value->as_number() < 0)) {
        return failure("offset must be a whole number of characters, zero or more");
    }
    std::string log_path;
    bool has_log_path = false;
    json::Value reply;
    reply.set("ok", true);
    if (status->is_object()) {
        for (const auto& [key, value] : status->as_object()) {
            if (key == "output") {
                if (value.is_string()) {
                    log_path = value.as_string();
                    has_log_path = true;
                }
                continue;
            }
            reply.set(key, value);
        }
    }
    const json::Value* exit_code = status->find("exitCode");
    const json::Value* signal = status->find("signal");
    reply.set("exitCode", exit_code != nullptr ? *exit_code : json::Value(nullptr));
    reply.set("signal", signal != nullptr ? *signal : json::Value(nullptr));
    std::string text = has_log_path ? read_bytes(log_path) : std::string();
    std::size_t length = utf16_length(text);
    std::size_t from = offset_value != nullptr ? static_cast<std::size_t>(offset_value->as_number())
                                               : (length > output_page ? length - output_page : 0);
    std::size_t end = std::min(from + output_page, length);
    reply.set("output", utf16_slice(text, from, end));
    reply.set("total", static_cast<std::uint64_t>(length));
    reply.set("truncated", from > 0 || end < length);
    reply.set("offset", static_cast<std::uint64_t>(from));
    reply.set("next", end < length ? json::Value(static_cast<std::uint64_t>(end)) : json::Value(nullptr));
    reply.set("logPath", has_log_path ? json::Value(log_path) : json::Value(nullptr));
    return reply;
}

json::Value JobTable::stop(const json::Value& args) {
    const json::Value* name_value = args.find("job");
    if (!is_job_name(name_value)) return failure("job must be a job name");
    const std::string& name = name_value->as_string();
    std::unique_lock lock(mutex_);
    auto found = jobs_.find(name);
    if (found == jobs_.end()) return failure("no job named " + name);
    Job& job = *found->second;
    if (job.settled) {
        lock.unlock();
        auto status = read_status(name);
        std::string state;
        if (status) {
            if (const json::Value* s = status->find("state"); s != nullptr && s->is_string()) state = s->as_string();
        }
        return failure("job " + name + " already ended (" + state + ")");
    }
    job.kill_requested = true;
    if (!job.kill_reason) job.kill_reason = "cancelled";
#if !defined(_WIN32)
    kill_group(job.pid);
#endif
    changed_.wait(lock, [&] { return job.settled; });
    json::Value reply;
    reply.set("ok", true);
    reply.set("state", "killed");
    reply.set("reason", *job.kill_reason);
    reply.set("output", "stopped job " + name);
    return reply;
}

void JobTable::close(std::string_view reason) {
    std::unique_lock lock(mutex_);
    std::vector<Job*> running;
    for (auto& [name, job] : jobs_) {
        if (job->settled) continue;
        job->kill_requested = true;
        if (!job->kill_reason) job->kill_reason = std::string(reason);
        running.push_back(job.get());
    }
#if !defined(_WIN32)
    for (Job* job : running) kill_group(job->pid);
#endif
    changed_.wait(lock, [&] { return std::all_of(running.begin(), running.end(), [](Job* job) { return job->settled; }); });
}

void JobTable::stop_orphans() {
    std::error_code ec;
    if (log_.dir().empty() || !std::filesystem::is_directory(jobs_dir(), ec)) return;
    for (const auto& entry : std::filesystem::directory_iterator(jobs_dir(), ec)) {
        if (entry.path().extension() != ".json") continue;
        std::string name = entry.path().stem().string();
        auto status = read_status(name);
        if (!status) continue;
        const json::Value* state = status->find("state");
        if (state == nullptr || !state->is_string() || (state->as_string() != "running" && state->as_string() != "queued")) continue;
        const json::Value* body = status->find("body");
        bool is_body = body != nullptr && !body->is_null();
        std::string tail;
        if (!is_body) {
            if (const json::Value* output = status->find("output"); output != nullptr && output->is_string()) {
                tail = utf16_tail(read_bytes(output->as_string()), tail_cap);
            }
#if !defined(_WIN32)
            if (const json::Value* pid = status->find("pid"); pid != nullptr && pid->is_number()) {
                kill_group_now(static_cast<int>(pid->as_number()));
            }
#endif
        }
        json::Value ended = *status;
        ended.set("state", "killed");
        ended.set("reason", "restart");
        const json::Value* job_name = status->find("job");
        std::string written_name = job_name != nullptr && job_name->is_string() ? job_name->as_string() : name;
        write_status(written_name, ended);
        json::Value event;
        event.set("job", written_name);
        if (is_body) event.set("body", *body);
        event.set("state", "killed");
        if (const json::Value* start_mono = status->find("startMono")) event.set("startMono", *start_mono);
        event.set("reason", "restart");
        log_.append("job", std::move(event));
        json::Value killed;
        killed.set("job", written_name);
        killed.set("reason", "restart");
        killed.set("tail", tail);
        log_.append("job-killed", std::move(killed));
    }
}

}  // namespace gmnew::core
