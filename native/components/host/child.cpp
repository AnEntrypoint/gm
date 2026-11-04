#include "gmnew/host/child.hpp"

#include <cstring>
#include <thread>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif
extern char** environ;
#endif

namespace gmnew::host {

#if !defined(_WIN32)

struct Child::Handles {
    pid_t pid = -1;
    int input = -1;
    int output = -1;
};

namespace {

bool cloexec_pipe(int fds[2]) {
    if (::pipe(fds) != 0) return false;
    ::fcntl(fds[0], F_SETFD, FD_CLOEXEC);
    ::fcntl(fds[1], F_SETFD, FD_CLOEXEC);
    return true;
}

int decode_status(int status) {
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return -1;
}

}  // namespace

deoxidene::Result<std::shared_ptr<Child>, std::string> Child::spawn(const std::vector<std::string>& argv,
                                                                    const std::filesystem::path& cwd) {
    if (argv.empty()) return deoxidene::Err<std::string>("no program to start");
    int in_fds[2];
    int out_fds[2];
    if (!cloexec_pipe(in_fds)) return deoxidene::Err<std::string>("pipe failed");
    if (!cloexec_pipe(out_fds)) {
        ::close(in_fds[0]);
        ::close(in_fds[1]);
        return deoxidene::Err<std::string>("pipe failed");
    }
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, in_fds[0], 0);
    posix_spawn_file_actions_adddup2(&actions, out_fds[1], 1);
    const std::string dir = cwd.string();
#if defined(__GLIBC__) || defined(__APPLE__)
    if (!dir.empty()) posix_spawn_file_actions_addchdir_np(&actions, dir.c_str());
#endif
    std::vector<char*> args;
    for (const auto& a : argv) args.push_back(const_cast<char*>(a.c_str()));
    args.push_back(nullptr);
    pid_t pid = -1;
    const int rc = posix_spawnp(&pid, args[0], &actions, nullptr, args.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    ::close(in_fds[0]);
    ::close(out_fds[1]);
    if (rc != 0) {
        ::close(in_fds[1]);
        ::close(out_fds[0]);
        return deoxidene::Err<std::string>("cannot start " + argv[0] + ": " + std::strerror(rc));
    }
    std::shared_ptr<Child> child(new Child());
    child->handles_ = std::make_unique<Handles>();
    child->handles_->pid = pid;
    child->handles_->input = in_fds[1];
    child->handles_->output = out_fds[0];
    return child;
}

Child::~Child() {
    close_input();
    if (handles_->output >= 0) ::close(handles_->output);
    if (!exit_code_) {
        kill();
        wait_for(std::chrono::milliseconds(2000));
    }
}

bool Child::write_line(std::string_view line) {
    std::lock_guard lock(write_mutex_);
    if (handles_->input < 0) return false;
    std::string data(line);
    data.push_back('\n');
    std::size_t done = 0;
    while (done < data.size()) {
        const ssize_t n = ::write(handles_->input, data.data() + done, data.size() - done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        done += static_cast<std::size_t>(n);
    }
    return true;
}

std::optional<std::string> Child::read_line() {
    for (;;) {
        const auto at = read_buffer_.find('\n');
        if (at != std::string::npos) {
            std::string line = read_buffer_.substr(0, at);
            read_buffer_.erase(0, at + 1);
            if (!line.empty() && line.back() == '\r') line.pop_back();
            return line;
        }
        char chunk[65536];
        const ssize_t n = ::read(handles_->output, chunk, sizeof chunk);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            if (read_buffer_.empty()) return std::nullopt;
            std::string rest;
            rest.swap(read_buffer_);
            return rest;
        }
        read_buffer_.append(chunk, static_cast<std::size_t>(n));
    }
}

void Child::close_input() {
    std::lock_guard lock(write_mutex_);
    if (handles_->input >= 0) ::close(handles_->input);
    handles_->input = -1;
}

void Child::terminate() {
    if (!exit_code_) ::kill(handles_->pid, SIGTERM);
}

void Child::kill() {
    if (!exit_code_) ::kill(handles_->pid, SIGKILL);
}

std::optional<int> Child::wait_for(std::chrono::milliseconds timeout) {
    std::lock_guard lock(wait_mutex_);
    if (exit_code_) return exit_code_;
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    for (;;) {
        int status = 0;
        const pid_t got = ::waitpid(handles_->pid, &status, WNOHANG);
        if (got == handles_->pid) {
            exit_code_ = decode_status(status);
            return exit_code_;
        }
        if (got < 0 && errno != EINTR) {
            exit_code_ = -1;
            return exit_code_;
        }
        if (std::chrono::steady_clock::now() >= deadline) return std::nullopt;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

long long Child::pid() const { return handles_->pid; }

std::filesystem::path current_executable() {
#if defined(__APPLE__)
    char buffer[4096];
    std::uint32_t size = sizeof buffer;
    if (_NSGetExecutablePath(buffer, &size) == 0) return std::filesystem::weakly_canonical(buffer);
    return {};
#else
    std::error_code ec;
    auto path = std::filesystem::read_symlink("/proc/self/exe", ec);
    return ec ? std::filesystem::path{} : path;
#endif
}

#else

struct Child::Handles {
    PROCESS_INFORMATION process{};
    HANDLE input = nullptr;
    HANDLE output = nullptr;
};

namespace {

std::wstring widen(const std::string& s) {
    if (s.empty()) return {};
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<std::size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

std::wstring quote_argument(const std::wstring& arg) {
    if (!arg.empty() && arg.find_first_of(L" \t\"") == std::wstring::npos) return arg;
    std::wstring out = L"\"";
    std::size_t slashes = 0;
    for (wchar_t c : arg) {
        if (c == L'\\') {
            ++slashes;
            continue;
        }
        out.append(c == L'"' ? slashes * 2 + 1 : slashes, L'\\');
        slashes = 0;
        out.push_back(c);
    }
    out.append(slashes * 2, L'\\');
    out.push_back(L'"');
    return out;
}

}  // namespace

deoxidene::Result<std::shared_ptr<Child>, std::string> Child::spawn(const std::vector<std::string>& argv,
                                                                    const std::filesystem::path& cwd) {
    if (argv.empty()) return deoxidene::Err<std::string>("no program to start");
    SECURITY_ATTRIBUTES inherit{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE in_read, in_write, out_read, out_write;
    if (!CreatePipe(&in_read, &in_write, &inherit, 0)) return deoxidene::Err<std::string>("pipe failed");
    if (!CreatePipe(&out_read, &out_write, &inherit, 0)) {
        CloseHandle(in_read);
        CloseHandle(in_write);
        return deoxidene::Err<std::string>("pipe failed");
    }
    SetHandleInformation(in_write, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(out_read, HANDLE_FLAG_INHERIT, 0);
    std::wstring command;
    for (const auto& a : argv) {
        if (!command.empty()) command.push_back(L' ');
        command += quote_argument(widen(a));
    }
    STARTUPINFOW startup{};
    startup.cb = sizeof startup;
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = in_read;
    startup.hStdOutput = out_write;
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION process{};
    const std::wstring dir = cwd.wstring();
    const BOOL ok = CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_NEW_PROCESS_GROUP, nullptr,
                                   dir.empty() ? nullptr : dir.c_str(), &startup, &process);
    CloseHandle(in_read);
    CloseHandle(out_write);
    if (!ok) {
        CloseHandle(in_write);
        CloseHandle(out_read);
        return deoxidene::Err<std::string>("cannot start " + argv[0]);
    }
    std::shared_ptr<Child> child(new Child());
    child->handles_ = std::make_unique<Handles>();
    child->handles_->process = process;
    child->handles_->input = in_write;
    child->handles_->output = out_read;
    return child;
}

Child::~Child() {
    close_input();
    if (handles_->output) CloseHandle(handles_->output);
    if (!exit_code_) {
        kill();
        wait_for(std::chrono::milliseconds(2000));
    }
    CloseHandle(handles_->process.hThread);
    CloseHandle(handles_->process.hProcess);
}

bool Child::write_line(std::string_view line) {
    std::lock_guard lock(write_mutex_);
    if (!handles_->input) return false;
    std::string data(line);
    data.push_back('\n');
    DWORD written = 0;
    return WriteFile(handles_->input, data.data(), static_cast<DWORD>(data.size()), &written, nullptr) &&
           written == data.size();
}

std::optional<std::string> Child::read_line() {
    for (;;) {
        const auto at = read_buffer_.find('\n');
        if (at != std::string::npos) {
            std::string line = read_buffer_.substr(0, at);
            read_buffer_.erase(0, at + 1);
            if (!line.empty() && line.back() == '\r') line.pop_back();
            return line;
        }
        char chunk[65536];
        DWORD n = 0;
        if (!ReadFile(handles_->output, chunk, sizeof chunk, &n, nullptr) || n == 0) {
            if (read_buffer_.empty()) return std::nullopt;
            std::string rest;
            rest.swap(read_buffer_);
            return rest;
        }
        read_buffer_.append(chunk, n);
    }
}

void Child::close_input() {
    std::lock_guard lock(write_mutex_);
    if (handles_->input) CloseHandle(handles_->input);
    handles_->input = nullptr;
}

void Child::terminate() { close_input(); }

void Child::kill() {
    if (!exit_code_) TerminateProcess(handles_->process.hProcess, 137);
}

std::optional<int> Child::wait_for(std::chrono::milliseconds timeout) {
    std::lock_guard lock(wait_mutex_);
    if (exit_code_) return exit_code_;
    if (WaitForSingleObject(handles_->process.hProcess, static_cast<DWORD>(timeout.count())) != WAIT_OBJECT_0)
        return std::nullopt;
    DWORD code = 0;
    GetExitCodeProcess(handles_->process.hProcess, &code);
    exit_code_ = static_cast<int>(code);
    return exit_code_;
}

long long Child::pid() const { return handles_->process.dwProcessId; }

std::filesystem::path current_executable() {
    wchar_t buffer[32768];
    const DWORD n = GetModuleFileNameW(nullptr, buffer, 32768);
    return n == 0 ? std::filesystem::path{} : std::filesystem::path(std::wstring(buffer, n));
}

#endif

}  // namespace gmnew::host
