#include "gm/proc.hpp"

#include <chrono>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <sstream>

#if defined(__APPLE__)
#include <libproc.h>
#include <sys/sysctl.h>
#endif
#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
#endif

namespace gm::proc {

unsigned long hidden_creation_flags(unsigned long flags) {
#if defined(_WIN32)
    return flags | CREATE_NO_WINDOW;
#else
    return flags;
#endif
}

namespace {

thread_local Owner current_owner = 0;
thread_local std::filesystem::path current_ledger;
std::mutex registry_mutex;
std::vector<std::pair<Owner, long long>> registry;

void kill_tree(long long pid) {
#if defined(_WIN32)
    run({"taskkill", "/PID", std::to_string(pid), "/T", "/F"});
#else
    ::kill(-static_cast<pid_t>(pid), SIGKILL);
#endif
}

}

long long start_time_of(long long pid) {
#if defined(__linux__)
    std::ifstream stat("/proc/" + std::to_string(pid) + "/stat");
    std::string text((std::istreambuf_iterator<char>(stat)), std::istreambuf_iterator<char>());
    const std::size_t close = text.rfind(')');
    if (close == std::string::npos) return 0;
    std::istringstream fields(text.substr(close + 2));
    std::string field;
    for (int index = 3; fields >> field; ++index) {
        if (index == 22) return std::atoll(field.c_str());
    }
#elif defined(__APPLE__)
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, static_cast<int>(pid)};
    struct kinfo_proc info {};
    std::size_t size = sizeof info;
    if (sysctl(mib, 4, &info, &size, nullptr, 0) != 0 || size == 0) return 0;
    return static_cast<long long>(info.kp_proc.p_starttime.tv_sec) * 1000000LL + info.kp_proc.p_starttime.tv_usec;
#else
    (void)pid;
#endif
    return 0;
}

std::vector<ProcessRow> process_table() {
    std::vector<ProcessRow> rows;
#if defined(_WIN32)
#elif defined(__linux__)
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
        ProcessRow row;
        row.pid = std::stoll(name);
        rest >> state >> row.parent;
        row.zombie = state == "Z";
        rows.push_back(row);
    }
#else
    const auto listed = run({"ps", "-axo", "pid=,ppid=,stat="});
    std::istringstream lines(listed.out);
    std::string line;
    while (std::getline(lines, line)) {
        std::istringstream fields(line);
        ProcessRow row;
        std::string state;
        if (fields >> row.pid >> row.parent >> state) {
            row.zombie = state[0] == 'Z';
            rows.push_back(row);
        }
    }
#endif
    return rows;
}

std::filesystem::path process_exe(long long pid) {
#if defined(__linux__)
    std::error_code ec;
    const auto exe = std::filesystem::read_symlink("/proc/" + std::to_string(pid) + "/exe", ec);
    return ec ? std::filesystem::path{} : exe;
#elif defined(__APPLE__)
    char buffer[PROC_PIDPATHINFO_MAXSIZE];
    const int length = proc_pidpath(static_cast<int>(pid), buffer, sizeof buffer);
    return length > 0 ? std::filesystem::path(std::string(buffer, static_cast<std::size_t>(length))) : std::filesystem::path{};
#else
    (void)pid;
    return {};
#endif
}

std::vector<std::string> command_of(long long pid) {
    std::vector<std::string> args;
#if defined(__linux__)
    std::ifstream cmdline("/proc/" + std::to_string(pid) + "/cmdline", std::ios::binary);
    const std::string bytes((std::istreambuf_iterator<char>(cmdline)), std::istreambuf_iterator<char>());
    std::string arg;
    for (const char ch : bytes) {
        if (ch == '\0') {
            args.push_back(arg);
            arg.clear();
        } else {
            arg += ch;
        }
    }
    if (!arg.empty()) args.push_back(arg);
#else
    const auto listed = run({"ps", "-ww", "-o", "command=", "-p", std::to_string(pid)});
    std::istringstream words(listed.out);
    std::string word;
    while (words >> word) args.push_back(word);
#endif
    return args;
}

long long resident_kb(long long pid) {
#if defined(__linux__)
    std::ifstream status("/proc/" + std::to_string(pid) + "/status");
    std::string line;
    while (std::getline(status, line)) {
        if (line.rfind("VmRSS:", 0) == 0) return std::stoll(line.substr(6));
    }
    return -1;
#else
    const auto listed = run({"ps", "-o", "rss=", "-p", std::to_string(pid)});
    if (!listed.started || listed.exit_code != 0 || listed.out.empty()) return -1;
    return std::stoll(listed.out);
#endif
}

namespace {

void append_ledger(const std::filesystem::path& ledger, long long pid) {
    std::error_code ec;
    std::filesystem::create_directories(ledger.parent_path(), ec);
    std::ofstream(ledger, std::ios::app) << pid << ' ' << start_time_of(pid) << '\n';
}

void forget_ledger(const std::filesystem::path& ledger, long long pid) {
    std::ifstream in(ledger);
    std::vector<std::string> kept;
    const std::string gone = std::to_string(pid);
    for (std::string line; std::getline(in, line);) {
        if (line.substr(0, line.find(' ')) != gone) kept.push_back(line);
    }
    in.close();
    std::error_code ec;
    if (kept.empty()) {
        std::filesystem::remove(ledger, ec);
        return;
    }
    std::ofstream out(ledger, std::ios::trunc);
    for (const auto& line : kept) out << line << '\n';
}

class Enrolment {
public:
    explicit Enrolment(long long pid) : pid_(pid), owner_(current_owner), ledger_(current_ledger) {
        if (owner_ == 0) return;
        std::lock_guard guard(registry_mutex);
        registry.emplace_back(owner_, pid_);
        if (!ledger_.empty()) append_ledger(ledger_, pid_);
    }
    ~Enrolment() {
        if (owner_ == 0) return;
        std::lock_guard guard(registry_mutex);
        std::erase_if(registry, [this](const auto& entry) { return entry.second == pid_; });
        if (!ledger_.empty()) forget_ledger(ledger_, pid_);
    }
    Enrolment(const Enrolment&) = delete;
    Enrolment& operator=(const Enrolment&) = delete;

private:
    long long pid_;
    Owner owner_;
    std::filesystem::path ledger_;
};

}

OwnerScope::OwnerScope(Owner owner, std::filesystem::path ledger)
    : previous_(std::exchange(current_owner, owner)), previous_ledger_(std::exchange(current_ledger, std::move(ledger))) {}

OwnerScope::~OwnerScope() {
    current_owner = previous_;
    current_ledger = previous_ledger_;
}

void kill_owned(Owner owner) {
    std::lock_guard guard(registry_mutex);
    for (const auto& [entry_owner, pid] : registry) {
        if (entry_owner == owner) kill_tree(pid);
    }
}

void reap_ledger(const std::filesystem::path& ledger) {
    std::ifstream in(ledger);
    for (std::string line; std::getline(in, line);) {
        const long long pid = std::atoll(line.c_str());
        const std::size_t space = line.find(' ');
        const long long started = space == std::string::npos ? 0 : std::atoll(line.c_str() + space + 1);
        if (pid <= 0) continue;
        const long long now = start_time_of(pid);
        if (started != 0 && now != 0 && now != started) continue;
        kill_tree(pid);
    }
    in.close();
    std::error_code ec;
    std::filesystem::remove(ledger, ec);
}

void reap_ledgers(const std::filesystem::path& dir) {
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) return;
    for (const auto& entry : std::filesystem::directory_iterator(dir, ec)) {
        if (entry.path().extension() == ".pids") reap_ledger(entry.path());
    }
}

#if !defined(_WIN32)

namespace {

using Clock = std::chrono::steady_clock;

struct Fd {
    int fd = -1;
    Fd() = default;
    explicit Fd(int value) : fd(value) {}
    Fd(const Fd&) = delete;
    Fd& operator=(const Fd&) = delete;
    ~Fd() { close(); }
    void close() {
        if (fd >= 0) ::close(fd);
        fd = -1;
    }
};

bool make_pipe(Fd& read_end, Fd& write_end) {
    int fds[2];
    if (::pipe(fds) != 0) return false;
    read_end.fd = fds[0];
    write_end.fd = fds[1];
    ::fcntl(fds[0], F_SETFD, FD_CLOEXEC);
    ::fcntl(fds[1], F_SETFD, FD_CLOEXEC);
    return true;
}

}

Outcome run(const std::vector<std::string>& argv, const std::filesystem::path& cwd, std::string_view stdin_text,
            std::uint64_t timeout_ms) {
    Outcome outcome;
    if (argv.empty()) return outcome;

    Fd in_read, in_write, out_read, out_write, err_read, err_write;
    if (!make_pipe(in_read, in_write) || !make_pipe(out_read, out_write) || !make_pipe(err_read, err_write))
        return outcome;

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, in_read.fd, 0);
    posix_spawn_file_actions_adddup2(&actions, out_write.fd, 1);
    posix_spawn_file_actions_adddup2(&actions, err_write.fd, 2);

    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP);
    posix_spawnattr_setpgroup(&attr, 0);

    std::vector<char*> args;
    for (const auto& a : argv) args.push_back(const_cast<char*>(a.c_str()));
    args.push_back(nullptr);

    pid_t pid = -1;
    int rc;
    const std::string dir = cwd.string();
    if (!dir.empty()) posix_spawn_file_actions_addchdir_np(&actions, dir.c_str());
    rc = posix_spawnp(&pid, args[0], &actions, &attr, args.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attr);
    if (rc != 0) return outcome;

    outcome.started = true;
    Enrolment enrolled(static_cast<long long>(pid));
    in_read.close();
    out_write.close();
    err_write.close();

    ::fcntl(in_write.fd, F_SETFL, ::fcntl(in_write.fd, F_GETFL) | O_NONBLOCK);
    ::signal(SIGPIPE, SIG_IGN);

    std::size_t written = 0;
    if (stdin_text.empty()) in_write.close();

    const auto deadline = Clock::now() + std::chrono::milliseconds(timeout_ms);
    bool reaped = false;
    int status = 0;
    siginfo_t info{};
    auto idle_since = Clock::now();
    char buffer[65536];

    while (out_read.fd >= 0 || err_read.fd >= 0 || in_write.fd >= 0) {
        pollfd fds[3];
        int count = 0;
        int out_i = -1, err_i = -1, in_i = -1;
        if (out_read.fd >= 0) { out_i = count; fds[count++] = {out_read.fd, POLLIN, 0}; }
        if (err_read.fd >= 0) { err_i = count; fds[count++] = {err_read.fd, POLLIN, 0}; }
        if (in_write.fd >= 0) { in_i = count; fds[count++] = {in_write.fd, POLLOUT, 0}; }

        int wait_ms = -1;
        if (timeout_ms > 0) {
            auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
            if (left <= 0) {
                ::kill(-pid, SIGKILL);
                outcome.timed_out = true;
                break;
            }
            wait_ms = static_cast<int>(left > 1000000 ? 1000000 : left);
        }
        if (!reaped && ::waitid(P_PID, pid, &info, WEXITED | WNOHANG | WNOWAIT) == 0 && info.si_pid == pid) {
            reaped = true;
            idle_since = Clock::now();
        }
        if (!reaped && (wait_ms < 0 || wait_ms > 20)) wait_ms = 20;
        if (reaped) {
            auto idle = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - idle_since).count();
            if (idle >= 100) break;
            wait_ms = 100 - static_cast<int>(idle);
        }
        int ready = ::poll(fds, count, wait_ms);
        if (ready < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (ready > 0) idle_since = Clock::now();
        auto drain = [&](Fd& fd, std::string& sink) {
            ssize_t n = ::read(fd.fd, buffer, sizeof buffer);
            if (n > 0) sink.append(buffer, static_cast<std::size_t>(n));
            else if (n == 0 || (errno != EINTR && errno != EAGAIN)) fd.close();
        };
        if (out_i >= 0 && fds[out_i].revents) drain(out_read, outcome.out);
        if (err_i >= 0 && fds[err_i].revents) drain(err_read, outcome.err);
        if (in_i >= 0 && fds[in_i].revents) {
            if (fds[in_i].revents & (POLLERR | POLLHUP)) {
                in_write.close();
            } else {
                ssize_t n = ::write(in_write.fd, stdin_text.data() + written, stdin_text.size() - written);
                if (n > 0) written += static_cast<std::size_t>(n);
                else if (n < 0 && errno != EINTR && errno != EAGAIN) in_write.close();
                if (written >= stdin_text.size()) in_write.close();
            }
        }
    }

    out_read.close();
    err_read.close();
    in_write.close();

    while (::waitid(P_PID, pid, &info, WEXITED | WNOWAIT) < 0 && errno == EINTR) {}
    ::kill(-pid, SIGKILL);
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    if (WIFEXITED(status)) outcome.exit_code = WEXITSTATUS(status);
    else if (WIFSIGNALED(status)) {
        outcome.exit_code = 128 + WTERMSIG(status);
        outcome.signal = WTERMSIG(status);
    }
    return outcome;
}

Outcome shell(std::string_view command, const std::filesystem::path& cwd, std::uint64_t timeout_ms) {
    const std::string sh = std::filesystem::exists("/bin/bash") ? "/bin/bash" : "/bin/sh";
    Outcome outcome = run({sh, "-c", std::string(command)}, cwd, {}, timeout_ms);
    outcome.launcher = sh;
    return outcome;
}

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

#else

namespace {

std::string read_available(HANDLE handle, bool& open) {
    std::string text;
    char buffer[65536];
    DWORD available = 0;
    while (PeekNamedPipe(handle, nullptr, 0, nullptr, &available, nullptr) && available > 0) {
        DWORD got = 0;
        if (!ReadFile(handle, buffer, sizeof buffer, &got, nullptr) || got == 0) break;
        text.append(buffer, got);
    }
    if (!PeekNamedPipe(handle, nullptr, 0, nullptr, &available, nullptr)) open = false;
    return text;
}

std::string quote(const std::string& arg) {
    if (!arg.empty() && arg.find_first_of(" \t\"") == std::string::npos) return arg;
    std::string quoted = "\"";
    for (char c : arg) {
        if (c == '"') quoted += '\\';
        quoted += c;
    }
    return quoted + "\"";
}

}

Outcome run(const std::vector<std::string>& argv, const std::filesystem::path& cwd, std::string_view stdin_text,
            std::uint64_t timeout_ms) {
    Outcome outcome;
    if (argv.empty()) return outcome;
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE in_r, in_w, out_r, out_w, err_r, err_w;
    CreatePipe(&in_r, &in_w, &sa, 0);
    CreatePipe(&out_r, &out_w, &sa, 0);
    CreatePipe(&err_r, &err_w, &sa, 0);
    SetHandleInformation(in_w, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(out_r, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(err_r, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOA si{};
    si.cb = sizeof si;
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = in_r;
    si.hStdOutput = out_w;
    si.hStdError = err_w;
    PROCESS_INFORMATION pi{};
    std::string command_line;
    for (const auto& a : argv) command_line += (command_line.empty() ? "" : " ") + quote(a);
    std::string dir = cwd.string();
    BOOL ok = CreateProcessA(nullptr, command_line.data(), nullptr, nullptr, TRUE,
                             static_cast<DWORD>(hidden_creation_flags(CREATE_NEW_PROCESS_GROUP)), nullptr, dir.empty() ? nullptr : dir.c_str(),
                             &si, &pi);
    CloseHandle(in_r);
    CloseHandle(out_w);
    CloseHandle(err_w);
    if (!ok) {
        CloseHandle(in_w);
        CloseHandle(out_r);
        CloseHandle(err_r);
        return outcome;
    }
    outcome.started = true;
    Enrolment enrolled(static_cast<long long>(pi.dwProcessId));
    DWORD wrote = 0;
    if (!stdin_text.empty()) WriteFile(in_w, stdin_text.data(), static_cast<DWORD>(stdin_text.size()), &wrote, nullptr);
    CloseHandle(in_w);

    const ULONGLONG start = GetTickCount64();
    bool out_open = true, err_open = true;
    for (;;) {
        outcome.out += read_available(out_r, out_open);
        outcome.err += read_available(err_r, err_open);
        if (WaitForSingleObject(pi.hProcess, 10) == WAIT_OBJECT_0) break;
        if (timeout_ms > 0 && GetTickCount64() - start >= timeout_ms) {
            kill_tree(static_cast<long long>(pi.dwProcessId));
            TerminateProcess(pi.hProcess, 1);
            WaitForSingleObject(pi.hProcess, INFINITE);
            outcome.timed_out = true;
            break;
        }
    }
    outcome.out += read_available(out_r, out_open);
    outcome.err += read_available(err_r, err_open);
    DWORD code = 0;
    GetExitCodeProcess(pi.hProcess, &code);
    outcome.exit_code = static_cast<int>(code);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    CloseHandle(out_r);
    CloseHandle(err_r);
    return outcome;
}

bool needs_cmd(std::string_view command) {
    const std::size_t first = command.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos) return false;
    const std::size_t last = command.find_first_of(" \t\r\n", first);
    const std::string_view word = command.substr(first, last == std::string_view::npos ? std::string_view::npos : last - first);
    const auto lower = [](char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c + 32) : c; };
    const auto is = [&](std::string_view name) {
        if (word.size() != name.size()) return false;
        for (std::size_t i = 0; i < name.size(); ++i) {
            if (lower(word[i]) != name[i]) return false;
        }
        return true;
    };
    if (is("dir") || is("del") || is("set")) return true;
    for (std::size_t i = 0; i < command.size(); ++i) {
        if (command[i] != '\\') continue;
        if (i == 0) continue;
        const char before = command[i - 1];
        const bool path = (before >= 'A' && before <= 'Z') || (before >= 'a' && before <= 'z') || (before >= '0' && before <= '9') || before == '.' || before == ':' || before == '\\';
        if (path) return true;
    }
    return false;
}

std::string git_bash() {
    for (const char* var : {"ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"}) {
        const char* root = std::getenv(var);
        if (root == nullptr) continue;
        const std::filesystem::path candidate = std::filesystem::path(root) / "Git" / "bin" / "bash.exe";
        if (std::filesystem::exists(candidate)) return candidate.string();
    }
    return {};
}

Outcome shell(std::string_view command, const std::filesystem::path& cwd, std::uint64_t timeout_ms) {
    const std::string text(command);
    const std::string bash = git_bash();
    const bool use_cmd = needs_cmd(command) || bash.empty();
    Outcome outcome = use_cmd
        ? run({"cmd", "/c", text}, cwd, {}, timeout_ms)
        : run({bash, "-c", text}, cwd, {}, timeout_ms);
    outcome.launcher = use_cmd ? "cmd" : bash;
    return outcome;
}

const char* signal_name(int) { return nullptr; }

#endif

}
