#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <vector>

#include "core_internal.hpp"
#include "gm/clock.hpp"
#include "gm/job_text.hpp"
#include "gm/proc.hpp"

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <cwchar>
#include <wchar.h>
#else
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
#endif

namespace gm::core {

using gm::jobs::kill_statement;

namespace {

#if !defined(_WIN32)
constexpr std::uint64_t kill_grace_ms = 500;
#endif
const double max_wait_ms = 60000 * clock_scale();
constexpr int pid_poll_ms = 100;
constexpr std::uint64_t ended_event_grace_ms = 250;

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

struct Spawned {
    int pid = -1;
    std::string error;
#if defined(_WIN32)
    HANDLE process = nullptr;
    HANDLE job = nullptr;
#endif
};

#if defined(_WIN32)

std::wstring widen(const std::string& text) {
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring wide(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), wide.data(), size);
    return wide;
}

std::vector<wchar_t> environment_block_without_api_key() {
    static const wchar_t key_prefix[] = L"ANTHROPIC_API_KEY=";
    std::vector<wchar_t> block;
    wchar_t* strings = GetEnvironmentStringsW();
    if (strings != nullptr) {
        for (const wchar_t* entry = strings; *entry != L'\0'; entry += std::wcslen(entry) + 1) {
            if (_wcsnicmp(entry, key_prefix, std::wcslen(key_prefix)) == 0) continue;
            block.insert(block.end(), entry, entry + std::wcslen(entry) + 1);
        }
        FreeEnvironmentStringsW(strings);
    }
    block.push_back(L'\0');
    return block;
}

Spawned spawn_shell_job(const std::string& command, const std::filesystem::path& cwd, const std::filesystem::path& out, const std::filesystem::path&) {
    Spawned result;
    SECURITY_ATTRIBUTES inherit{sizeof inherit, nullptr, TRUE};
    HANDLE output = CreateFileW(out.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_DELETE, &inherit, CREATE_ALWAYS,
                                FILE_ATTRIBUTE_NORMAL, nullptr);
    HANDLE input = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &inherit, OPEN_EXISTING, 0, nullptr);
    if (output == INVALID_HANDLE_VALUE || input == INVALID_HANDLE_VALUE) {
        if (output != INVALID_HANDLE_VALUE) CloseHandle(output);
        if (input != INVALID_HANDLE_VALUE) CloseHandle(input);
        result.error = "cannot open the job output " + out.string();
        return result;
    }
    STARTUPINFOW startup{};
    startup.cb = sizeof startup;
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = input;
    startup.hStdOutput = output;
    startup.hStdError = output;
    std::wstring line = L"cmd.exe /d /s /c \"" + widen(command) + L"\"";
    std::vector<wchar_t> line_buffer(line.begin(), line.end());
    line_buffer.push_back(L'\0');
    const std::wstring dir = cwd.wstring();
    std::vector<wchar_t> environment = environment_block_without_api_key();
    PROCESS_INFORMATION process{};
    const HANDLE job = CreateJobObjectW(nullptr, nullptr);
    const BOOL created = CreateProcessW(nullptr, line_buffer.data(), nullptr, nullptr, TRUE,
                                        static_cast<DWORD>(gm::proc::hidden_creation_flags(CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT)), environment.data(),
                                        dir.empty() ? nullptr : dir.c_str(), &startup, &process);
    CloseHandle(input);
    CloseHandle(output);
    if (!created) {
        result.error = "spawn cmd.exe failed with error " + std::to_string(GetLastError());
        if (job != nullptr) CloseHandle(job);
        return result;
    }
    if (job == nullptr || !AssignProcessToJobObject(job, process.hProcess)) {
        result.error = "cannot place the job in a job object (error " + std::to_string(GetLastError()) + ")";
        TerminateProcess(process.hProcess, 1);
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        if (job != nullptr) CloseHandle(job);
        return result;
    }
    ResumeThread(process.hThread);
    CloseHandle(process.hThread);
    result.pid = static_cast<int>(process.dwProcessId);
    result.process = process.hProcess;
    result.job = job;
    return result;
}

#else

void kill_group(int pid) {
    if (::kill(-pid, SIGTERM) != 0) return;
    std::thread([pid] {
        std::this_thread::sleep_for(std::chrono::milliseconds(kill_grace_ms));
        ::kill(-pid, SIGKILL);
    }).detach();
}

void kill_group_now(int pid) { ::kill(-pid, SIGKILL); }

Spawned spawn_shell_job(const std::string& command, const std::filesystem::path& cwd, const std::filesystem::path& out, const std::filesystem::path& exit_file) {
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

    std::string shell = std::filesystem::exists("/bin/bash") ? "/bin/bash" : "/bin/sh";
    std::string dash_c = "-c";
    std::string line = "(eval \"$1\"); s=$?; echo $s > \"$2\"; exit $s";
    std::string script_name = "gm-job";
    std::string command_arg = command;
    std::string exit_arg = exit_file.string();
    char* argv[] = {shell.data(), dash_c.data(), line.data(), script_name.data(), command_arg.data(), exit_arg.data(), nullptr};

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
        result.error = "spawn " + shell + " " + std::string(std::strerror(rc));
        return result;
    }
    result.pid = static_cast<int>(pid);
    return result;
}

#endif

}

struct JobTable::Job {
    std::string name;
    int pid = -1;
    std::filesystem::path dir;
    std::filesystem::path out;
    json::Value status;
    double start_mono = 0;
    std::optional<double> mono_offset;
    std::filesystem::file_time_type start_file_time;
    std::optional<std::filesystem::path> progress;
    std::string state = "running";
    bool stuck = false;
    bool settled = false;
    bool kill_requested = false;
    bool lifetime_killed = false;
    std::uint64_t timeout_ms = 0;
    std::optional<std::string> kill_reason;
#if defined(_WIN32)
    HANDLE process = nullptr;
    HANDLE job_object = nullptr;
#endif
    std::thread waiter;
    std::thread timer;

    void kill_tree() {
#if defined(_WIN32)
        if (job_object != nullptr) TerminateJobObject(job_object, 1);
#else
        kill_group(pid);
#endif
    }
};

JobTable::JobTable(std::filesystem::path workspace, LockedLog& log, std::uint64_t lifetime_ms)
    : workspace_(std::move(workspace)), log_(log), lifetime_ms_(lifetime_ms) {}

JobTable::~JobTable() {
    close("run-ended");
    for (auto& [name, job] : jobs_) {
        if (job->waiter.joinable()) job->waiter.join();
        if (job->timer.joinable()) job->timer.join();
#if defined(_WIN32)
        if (job->process != nullptr) CloseHandle(job->process);
        if (job->job_object != nullptr) CloseHandle(job->job_object);
#endif
    }
}

void JobTable::write_status(const std::filesystem::path& dir, const std::string& name, const json::Value& status) {
    auto file = dir / (name + ".json");
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

double wall_ms_now() {
    return std::chrono::duration<double, std::milli>(std::chrono::system_clock::now().time_since_epoch()).count();
}

std::filesystem::path JobTable::exit_file_of(const std::string& name) const { return jobs_dir() / (name + ".exit"); }

std::optional<int> JobTable::read_exit_code(const std::string& name) const {
    std::ifstream in(exit_file_of(name));
    int code = 0;
    if (!(in >> code)) return std::nullopt;
    return code;
}

json::Value JobTable::start(const std::string& name, const std::string& command, std::uint64_t timeout_ms, const std::optional<std::string>& progress) {
    std::unique_lock lock(mutex_);
    if (jobs_.contains(job_key(name))) return failure("job " + name + " already exists");
    std::error_code ec;
    std::filesystem::create_directories(jobs_dir(), ec);
    auto out = jobs_dir() / (name + ".out");
    { std::ofstream create(out, std::ios::binary | std::ios::trunc); }
    auto exit_file = exit_file_of(name);
    std::filesystem::remove(exit_file, ec);
    const double start_wall = wall_ms_now();
    Spawned spawned = spawn_shell_job(command, workspace_, out, exit_file);
    if (spawned.pid < 0) return failure(spawned.error);

    json::Value running;
    running.set("job", name);
    running.set("state", "running");
    running.set("pid", spawned.pid);
    std::uint64_t seq = log_.append("job", std::move(running));
    double start_mono = 0;
    if (auto events = log_.read_last(1); events && !events->empty()) {
        const json::Value& last = events->back();
        const json::Value* s = last.find("seq");
        if (s != nullptr && s->as_number() == static_cast<double>(seq)) {
            if (const json::Value* m = last.find("mono")) start_mono = m->as_number();
        }
    }
    const double mono_offset = start_mono - steady_ms();

    auto job = std::make_unique<Job>();
    job->name = name;
    job->pid = spawned.pid;
#if defined(_WIN32)
    job->process = spawned.process;
    job->job_object = spawned.job;
#endif
    job->dir = jobs_dir();
    job->out = out;
    job->start_mono = start_mono;
    job->mono_offset = mono_offset;
    job->start_file_time = std::filesystem::file_time_type::clock::now();
    if (progress) job->progress = std::filesystem::path(*progress).is_absolute() ? std::filesystem::path(*progress) : workspace_ / *progress;
    std::uint64_t deadline_ms = std::min(timeout_ms, lifetime_ms_);
    job->lifetime_killed = lifetime_ms_ < timeout_ms;
    job->timeout_ms = deadline_ms;
    job->status.set("job", name);
    job->status.set("command", command);
    job->status.set("state", "running");
    job->status.set("pid", spawned.pid);
    job->status.set("startMono", start_mono);
    job->status.set("startWall", start_wall);
    job->status.set("output", out.string());
    job->status.set("timeoutMs", deadline_ms);
    write_status(jobs_dir(), name, job->status);

    Job& ref = *job;
    jobs_.emplace(job_key(name), std::move(job));
    ref.waiter = std::thread([this, &ref] {
#if defined(_WIN32)
        WaitForSingleObject(ref.process, INFINITE);
        DWORD code = 0;
        GetExitCodeProcess(ref.process, &code);
        settle(ref, static_cast<int>(code), nullptr);
#else
        int raw = 0;
        while (::waitpid(ref.pid, &raw, 0) < 0 && errno == EINTR) {
        }
        if (WIFEXITED(raw)) {
            settle(ref, WEXITSTATUS(raw), nullptr);
        } else if (WIFSIGNALED(raw)) {
            const char* signal_text = proc::signal_name(WTERMSIG(raw));
            settle(ref, std::nullopt, signal_text != nullptr ? json::Value(signal_text) : json::Value(WTERMSIG(raw)));
        } else {
            settle(ref, std::nullopt, nullptr);
        }
#endif
        flush_after_grace();
    });
    ref.timer = std::thread([this, &ref, deadline_ms] { watch(ref, deadline_ms); });

    json::Value reply;
    reply.set("ok", true);
    reply.set("state", "running");
    reply.set("output", "started job " + name + " (pid " + std::to_string(spawned.pid) + ")");
    reply.set("pid", spawned.pid);
    reply.set("doneFile", exit_file.string());
    reply.set("logPath", out.string());
    return reply;
}

void JobTable::watch(Job& job, std::uint64_t deadline_ms) {
    std::unique_lock lock(mutex_);
    if (changed_.wait_for(lock, std::chrono::milliseconds(deadline_ms), [&] { return job.settled; })) return;
    job.kill_requested = true;
    job.kill_reason = job.lifetime_killed ? "lifetime" : "timeout";
    lock.unlock();
    job.kill_tree();
}

void JobTable::settle(Job& job, std::optional<int> exit_code, json::Value signal) {
    std::unique_lock lock(mutex_);
    if (job.settled) return;
    bool exited = exit_code.has_value() && !job.kill_requested;
    std::string state = exited ? "exited" : "killed";
    std::optional<std::string> reason = exited ? std::nullopt : job.kill_reason;
    std::optional<std::string> statement;
    if (reason) statement = kill_statement(job.name, *reason, job.timeout_ms, lifetime_ms_);
    const bool timed_out = reason && *reason == "timeout";
    json::Value exit_value = exit_code ? json::Value(*exit_code) : json::Value(nullptr);

    json::Value ended = job.status;
    ended.set("state", state);
    ended.set("exitCode", exit_value);
    ended.set("signal", signal);
    if (reason) ended.set("reason", *reason);
    if (statement) ended.set("statement", *statement);
    if (timed_out) ended.set("timedOut", true);
    if (job.mono_offset) ended.set("durMs", std::round(round_mono(*job.mono_offset + steady_ms()) - job.start_mono));
    write_status(job.dir, job.name, ended);

    json::Value event;
    event.set("job", job.name);
    event.set("state", state);
    event.set("exitCode", exit_value);
    event.set("signal", signal);
    event.set("startMono", job.start_mono);
    if (reason) event.set("reason", *reason);
    if (statement) event.set("statement", *statement);
    if (timed_out) {
        event.set("timedOut", true);
        event.set("timeoutMs", job.timeout_ms);
    }
    json::Value check;
    check.set("command", core::check_key(job.status.find("command") && job.status.find("command")->is_string() ? job.status.find("command")->as_string() : std::string()));
    check.set("job", job.name);
    check.set("exitCode", exit_value);
    if (const json::Value* duration = ended.find("durMs")) check.set("durMs", *duration);
    unlogged_.push_back({"check", std::move(check)});
    unlogged_.push_back({"job", std::move(event)});
    if (job.kill_reason) {
        json::Value killed;
        killed.set("job", job.name);
        killed.set("reason", *job.kill_reason);
        killed.set("statement", *statement);
        if (*job.kill_reason == "lifetime") killed.set("lifetimeMs", static_cast<std::uint64_t>(lifetime_ms_));
        killed.set("tail", utf16_tail(read_bytes(job.out), tail_cap));
        unlogged_.push_back({"job-killed", std::move(killed)});
    }
    job.state = state;
    job.settled = true;
    changed_.notify_all();
}

void JobTable::flush_ended_locked() {
    if (unlogged_.empty()) return;
    for (auto& unlogged : unlogged_) log_.append(unlogged.kind, std::move(unlogged.fields));
    unlogged_.clear();
    changed_.notify_all();
}

void JobTable::flush_ended() {
    std::unique_lock lock(mutex_);
    flush_ended_locked();
}

void JobTable::flush_after_grace() {
    std::unique_lock lock(mutex_);
    changed_.wait_for(lock, std::chrono::milliseconds(ended_event_grace_ms), [&] { return unlogged_.empty(); });
    flush_ended_locked();
}

json::Value JobTable::snapshot(std::uint64_t stuck_ms) {
    using FileClock = std::filesystem::file_time_type::clock;
    auto whole_ms = [](FileClock::duration span) {
        return std::max<std::int64_t>(0, std::chrono::duration_cast<std::chrono::milliseconds>(span).count());
    };
    std::unique_lock lock(mutex_);
    flush_ended_locked();
    auto now = FileClock::now();
    json::Array listed;
    json::Array turned_stuck;
    json::Array progressed_again;
    for (auto& [key, job] : jobs_) {
        if (job->dir != jobs_dir()) continue;
        const std::string& name = job->name;
        std::error_code ec;
        auto written_at = [&](const std::filesystem::path& file) {
            std::error_code file_ec;
            auto written = std::filesystem::last_write_time(file, file_ec);
            return file_ec ? job->start_file_time : std::max(job->start_file_time, written);
        };
        auto progress = written_at(job->out);
        if (job->progress) progress = std::max(progress, written_at(*job->progress));
        std::int64_t since_progress_ms = whole_ms(now - progress);
        if (!job->settled) {
            bool over = since_progress_ms > static_cast<std::int64_t>(stuck_ms);
            if (over != job->stuck) {
                job->stuck = over;
                json::Value change;
                change.set("job", name);
                change.set("sinceProgressMs", since_progress_ms);
                std::uint64_t seq = log_.append(over ? "job-stuck" : "job-unstuck", change);
                json::Value shown;
                shown.set("seq", seq);
                shown.set("job", name);
                if (over) shown.set("sinceProgressMs", since_progress_ms);
                (over ? turned_stuck : progressed_again).push_back(std::move(shown));
            }
        }
        json::Value entry;
        entry.set("job", name);
        entry.set("state", job->state);
        entry.set("runningMs", whole_ms(now - job->start_file_time));
        entry.set("sinceProgressMs", since_progress_ms);
        entry.set("stuck", job->stuck && !job->settled);
        listed.push_back(std::move(entry));
    }
    json::Value reply;
    reply.set("jobs", std::move(listed));
    if (!turned_stuck.empty()) reply.set("jobsStuck", std::move(turned_stuck));
    if (!progressed_again.empty()) reply.set("jobsUnstuck", std::move(progressed_again));
    return reply;
}

json::Value wait_for_pid(const json::Value& pid_value, double wait_ms) {
    if (!is_whole_number(&pid_value) || pid_value.as_number() < 1) return failure("pid must be a whole number above zero");
#if defined(_WIN32)
    return failure("a pid wait is not served on Windows; start the command with job_start and pass job");
#else
    const auto pid = static_cast<pid_t>(pid_value.as_number());
    const auto alive = [pid] { return ::kill(pid, 0) == 0 || errno == EPERM; };
    const double started = steady_ms();
    while (alive() && steady_ms() - started < wait_ms) std::this_thread::sleep_for(std::chrono::milliseconds(pid_poll_ms));
    json::Value reply;
    reply.set("ok", true);
    reply.set("pid", pid_value);
    reply.set("state", alive() ? "running" : "gone");
    reply.set("exitCode", json::Value(nullptr));
    reply.set("waitedMs", static_cast<std::uint64_t>(steady_ms() - started));
    reply.set("output", "gm did not start this process, so it has no exit code or output for it");
    return reply;
#endif
}

json::Value JobTable::status(const json::Value& args) {
    if (const json::Value* pid_value = present(args, "pid"); pid_value != nullptr && present(args, "job") == nullptr) {
        const json::Value* w = args.find("waitMs");
        return wait_for_pid(*pid_value, w != nullptr && w->is_number() && std::isfinite(w->as_number()) ? std::clamp(w->as_number(), 0.0, max_wait_ms) : 0.0);
    }
    const json::Value* name_value = args.find("job");
    if (!is_job_name(name_value)) return failure("job must be a job name");
    const std::string& name = name_value->as_string();
    double wait_ms = 0;
    if (const json::Value* w = args.find("waitMs"); w != nullptr && w->is_number() && std::isfinite(w->as_number())) {
        wait_ms = std::clamp(w->as_number(), 0.0, max_wait_ms);
    }
    {
        std::unique_lock lock(mutex_);
        auto found = jobs_.find(job_key(name));
        if (found != jobs_.end() && !found->second->settled && wait_ms > 0) {
            Job& job = *found->second;
            changed_.wait_for(lock, std::chrono::duration<double, std::milli>(wait_ms), [&] { return job.settled; });
        }
        flush_ended_locked();
    }
    auto status = read_status(name);
    if (!status) return failure("no job named " + name);
    if (wait_ms > 0 && status->is_object()) {
        const json::Value* state = status->find("state");
        if (state && state->is_string() && state->as_string() == "running")
            status->set("hint", "the job is still running: call job_status again with waitMs to keep waiting");
    }
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
    const json::Value* tail_value = present(args, "tail");
    if (tail_value != nullptr && (!is_whole_number(tail_value) || tail_value->as_number() < 0)) {
        return failure("tail must be a whole number of characters, zero or more");
    }
    const std::size_t page = tail_value != nullptr ? std::min(static_cast<std::size_t>(tail_value->as_number()), static_cast<std::size_t>(output_page)) : output_page;
    std::size_t from = offset_value != nullptr ? static_cast<std::size_t>(offset_value->as_number())
                                               : (length > page ? length - page : 0);
    std::size_t end = std::min(from + page, length);
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
    auto found = jobs_.find(job_key(name));
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
    job.kill_tree();
    changed_.wait(lock, [&] { return job.settled; });
    flush_ended_locked();
    json::Value reply;
    reply.set("ok", true);
    reply.set("state", "killed");
    reply.set("reason", *job.kill_reason);
    reply.set("statement", kill_statement(name, *job.kill_reason, 0, lifetime_ms_));
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
    for (Job* job : running) job->kill_tree();
    changed_.wait(lock, [&] { return std::all_of(running.begin(), running.end(), [](Job* job) { return job->settled; }); });
    flush_ended_locked();
}

bool JobTable::adopt_orphan(const std::string& name, const json::Value& status) {
#if defined(_WIN32)
    (void)name;
    (void)status;
    return false;
#else
    {
        std::lock_guard lock(mutex_);
        if (jobs_.contains(job_key(name))) return true;
    }
    const json::Value* pid = status.find("pid");
    if (pid == nullptr || !pid->is_number()) return false;
    const int id = static_cast<int>(pid->as_number());
    if (::kill(id, 0) == 0 || errno == EPERM) return adopt_job(name, status);
    auto code = read_exit_code(name);
    if (!code) return false;
    json::Value ended = status;
    ended.set("state", "exited");
    ended.set("exitCode", *code);
    write_status(jobs_dir(), name, ended);
    json::Value event;
    event.set("job", name);
    event.set("state", "exited");
    event.set("exitCode", *code);
    log_.append("job", std::move(event));
    return true;
#endif
}

bool JobTable::adopt_job(const std::string& name, const json::Value& status) {
#if defined(_WIN32)
    (void)name;
    (void)status;
    return false;
#else
    const json::Value* pid = status.find("pid");
    const json::Value* start_mono = status.find("startMono");
    const json::Value* output = status.find("output");
    const json::Value* timeout = status.find("timeoutMs");
    if (pid == nullptr || start_mono == nullptr || output == nullptr || timeout == nullptr) return false;
    if (!pid->is_number() || !start_mono->is_number() || !output->is_string() || !timeout->is_number()) return false;
    std::unique_lock lock(mutex_);
    if (jobs_.contains(job_key(name))) return true;
    auto job = std::make_unique<Job>();
    job->name = name;
    job->pid = static_cast<int>(pid->as_number());
    job->dir = jobs_dir();
    job->out = output->as_string();
    job->status = status;
    job->start_mono = start_mono->as_number();
    job->start_file_time = std::filesystem::file_time_type::clock::now();
    const auto timeout_ms = static_cast<std::uint64_t>(timeout->as_number());
    job->timeout_ms = timeout_ms;
    job->lifetime_killed = timeout_ms >= lifetime_ms_;
    double elapsed_ms = 0;
    if (const json::Value* wall = status.find("startWall"); wall != nullptr && wall->is_number()) elapsed_ms = wall_ms_now() - wall->as_number();
    const double left = static_cast<double>(timeout_ms) - elapsed_ms;
    const std::uint64_t left_ms = left >= 1 ? static_cast<std::uint64_t>(left) : 1;
    Job& ref = *job;
    jobs_.emplace(job_key(name), std::move(job));
    ref.waiter = std::thread([this, &ref] { poll_adopted(ref); });
    ref.timer = std::thread([this, &ref, left_ms] { watch(ref, left_ms); });
    json::Value event;
    event.set("job", name);
    event.set("state", "running");
    event.set("pid", ref.pid);
    event.set("carried", true);
    log_.append("job", std::move(event));
    return true;
#endif
}

void JobTable::poll_adopted(Job& job) {
#if !defined(_WIN32)
    std::optional<int> code;
    int ticks_after_kill = 0;
    for (;;) {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        code = read_exit_code(job.name);
        if (code) break;
        if (::kill(job.pid, 0) != 0 && errno == ESRCH) break;
        std::lock_guard lock(mutex_);
        if (job.kill_requested && ++ticks_after_kill > 10) break;
    }
    settle(job, code, nullptr);
    flush_after_grace();
#else
    (void)job;
#endif
}

void JobTable::stop_orphans() {
    std::error_code ec;
    if (log_.dir().empty() || !std::filesystem::is_directory(jobs_dir(), ec)) return;
    proc::reap_ledgers(jobs_dir());
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
        if (!is_body && adopt_orphan(name, *status)) continue;
        if (!is_body) {
            if (const json::Value* output = status->find("output"); output != nullptr && output->is_string()) {
                tail = utf16_tail(read_bytes(output->as_string()), tail_cap);
            }
            if (const json::Value* pid = status->find("pid"); pid != nullptr && pid->is_number()) {
#if defined(_WIN32)
                proc::run({"taskkill", "/PID", std::to_string(static_cast<long long>(pid->as_number())), "/T", "/F"});
#else
                kill_group_now(static_cast<int>(pid->as_number()));
#endif
            }
        }
        json::Value ended = *status;
        ended.set("state", "killed");
        ended.set("reason", "restart");
        const json::Value* job_name = status->find("job");
        std::string written_name = job_name != nullptr && job_name->is_string() ? job_name->as_string() : name;
        const std::string statement = is_body ? gm::jobs::body_restart_statement(written_name) : kill_statement(written_name, "restart", 0, 0);
        ended.set("statement", statement);
        write_status(jobs_dir(), written_name, ended);
        json::Value event;
        event.set("job", written_name);
        if (is_body) event.set("body", *body);
        event.set("state", "killed");
        if (const json::Value* start_mono = status->find("startMono")) event.set("startMono", *start_mono);
        event.set("reason", "restart");
        event.set("statement", statement);
        log_.append("job", std::move(event));
        json::Value killed;
        killed.set("job", written_name);
        killed.set("reason", "restart");
        killed.set("statement", statement);
        killed.set("tail", tail);
        log_.append("job-killed", std::move(killed));
    }
}

}
