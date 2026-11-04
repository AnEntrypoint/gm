#include "gmnew/proc.hpp"

#include <chrono>
#include <cstring>

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

namespace gmnew::proc {

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

}  // namespace

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
    in_read.close();
    out_write.close();
    err_write.close();

    ::fcntl(in_write.fd, F_SETFL, ::fcntl(in_write.fd, F_GETFL) | O_NONBLOCK);
    ::signal(SIGPIPE, SIG_IGN);

    std::size_t written = 0;
    if (stdin_text.empty()) in_write.close();

    const auto deadline = Clock::now() + std::chrono::milliseconds(timeout_ms);
    bool killed = false;
    bool reaped = false;
    int status = 0;
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
                killed = true;
                outcome.timed_out = true;
                break;
            }
            wait_ms = static_cast<int>(left > 1000000 ? 1000000 : left);
        }
        if (!reaped && ::waitpid(pid, &status, WNOHANG) == pid) {
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

    if (killed) ::kill(-pid, SIGKILL);
    out_read.close();
    err_read.close();
    in_write.close();

    while (!reaped && ::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    if (WIFEXITED(status)) outcome.exit_code = WEXITSTATUS(status);
    else if (WIFSIGNALED(status)) outcome.exit_code = 128 + WTERMSIG(status);
    return outcome;
}

Outcome shell(std::string_view command, const std::filesystem::path& cwd, std::uint64_t timeout_ms) {
    return run({"/bin/sh", "-c", std::string(command)}, cwd, {}, timeout_ms);
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

}  // namespace

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
                             CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW, nullptr, dir.empty() ? nullptr : dir.c_str(),
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

Outcome shell(std::string_view command, const std::filesystem::path& cwd, std::uint64_t timeout_ms) {
    return run({"cmd", "/c", std::string(command)}, cwd, {}, timeout_ms);
}

#endif

}  // namespace gmnew::proc
