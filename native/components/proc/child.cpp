#include <algorithm>
#include <cstring>
#include <thread>

#include "gm/proc.hpp"

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wchar.h>
#include <cwchar>
#else
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
#endif

namespace gm::proc {

#if !defined(_WIN32)

struct Child::Handles {
    pid_t pid = -1;
    int input = -1;
    int output = -1;
    int error = -1;
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

std::vector<std::string> merged_environment(const std::vector<std::pair<std::string, std::string>>& overrides) {
    std::vector<std::string> entries;
    for (char** entry = environ; entry != nullptr && *entry != nullptr; ++entry) {
        std::string text = *entry;
        const std::string key = text.substr(0, text.find('='));
        const bool replaced = std::any_of(overrides.begin(), overrides.end(), [&](const auto& o) { return o.first == key; });
        if (!replaced) entries.push_back(std::move(text));
    }
    for (const auto& [key, value] : overrides) entries.push_back(key + "=" + value);
    return entries;
}

}

deoxidene::Result<std::shared_ptr<Child>, std::string> Child::spawn(const std::vector<std::string>& argv,
                                                                    const SpawnOptions& options) {
    if (argv.empty()) return deoxidene::Err<std::string>("no program to start");
    int in_fds[2];
    int out_fds[2];
    if (!cloexec_pipe(in_fds)) return deoxidene::Err<std::string>("pipe failed");
    if (!cloexec_pipe(out_fds)) {
        ::close(in_fds[0]);
        ::close(in_fds[1]);
        return deoxidene::Err<std::string>("pipe failed");
    }
    int err_fds[2] = {-1, -1};
    if (options.capture_stderr && !cloexec_pipe(err_fds)) {
        ::close(in_fds[0]);
        ::close(in_fds[1]);
        ::close(out_fds[0]);
        ::close(out_fds[1]);
        return deoxidene::Err<std::string>("pipe failed");
    }
    ::signal(SIGPIPE, SIG_IGN);
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, in_fds[0], 0);
    posix_spawn_file_actions_adddup2(&actions, out_fds[1], 1);
    if (err_fds[1] >= 0) posix_spawn_file_actions_adddup2(&actions, err_fds[1], 2);
    const std::string dir = options.cwd.string();
#if defined(__GLIBC__) || defined(__APPLE__)
    if (!dir.empty()) posix_spawn_file_actions_addchdir_np(&actions, dir.c_str());
#endif
    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    if (options.own_group) {
        posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP);
        posix_spawnattr_setpgroup(&attr, 0);
    }
    std::vector<std::string> environment = merged_environment(options.env);
    std::vector<char*> envp;
    for (auto& entry : environment) envp.push_back(entry.data());
    envp.push_back(nullptr);
    std::vector<char*> args;
    for (const auto& a : argv) args.push_back(const_cast<char*>(a.c_str()));
    args.push_back(nullptr);
    pid_t pid = -1;
    const int rc = posix_spawnp(&pid, args[0], &actions, &attr, args.data(), options.env.empty() ? environ : envp.data());
    posix_spawnattr_destroy(&attr);
    posix_spawn_file_actions_destroy(&actions);
    ::close(in_fds[0]);
    ::close(out_fds[1]);
    if (err_fds[1] >= 0) ::close(err_fds[1]);
    if (rc != 0) {
        ::close(in_fds[1]);
        ::close(out_fds[0]);
        if (err_fds[0] >= 0) ::close(err_fds[0]);
        return deoxidene::Err<std::string>("cannot start " + argv[0] + ": " + std::strerror(rc));
    }
    std::shared_ptr<Child> child(new Child());
    child->handles_ = std::make_unique<Handles>();
    child->handles_->pid = pid;
    child->handles_->input = in_fds[1];
    child->handles_->output = out_fds[0];
    child->handles_->error = err_fds[0];
    child->own_group_ = options.own_group;
    return child;
}

Child::~Child() {
    close_input();
    if (handles_->output >= 0) ::close(handles_->output);
    if (handles_->error >= 0) ::close(handles_->error);
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

std::optional<std::string> Child::read_error_chunk() {
    if (handles_->error < 0) return std::nullopt;
    char chunk[4096];
    for (;;) {
        const ssize_t n = ::read(handles_->error, chunk, sizeof chunk);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return std::nullopt;
        return std::string(chunk, static_cast<std::size_t>(n));
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
    if (!exit_code_) ::kill(own_group_ ? -handles_->pid : handles_->pid, SIGKILL);
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

#else

struct Child::Handles {
    PROCESS_INFORMATION process{};
    HANDLE input = nullptr;
    HANDLE output = nullptr;
    HANDLE error = nullptr;
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

bool same_variable(const std::wstring& line, const std::wstring& key) {
    const std::wstring name = line.substr(0, line.find(L'=', 1));
    return _wcsicmp(name.c_str(), key.c_str()) == 0;
}

std::wstring environment_block(const std::vector<std::pair<std::string, std::string>>& overrides) {
    std::vector<std::wstring> lines;
    wchar_t* current = GetEnvironmentStringsW();
    for (const wchar_t* at = current; at != nullptr && *at != L'\0'; at += std::wcslen(at) + 1) lines.emplace_back(at);
    FreeEnvironmentStringsW(current);
    for (const auto& [key, value] : overrides) {
        const std::wstring wide_key = widen(key);
        std::erase_if(lines, [&](const std::wstring& line) { return same_variable(line, wide_key); });
        lines.push_back(wide_key + L"=" + widen(value));
    }
    std::wstring block;
    for (const std::wstring& line : lines) {
        block += line;
        block.push_back(L'\0');
    }
    block.push_back(L'\0');
    return block;
}

}

deoxidene::Result<std::shared_ptr<Child>, std::string> Child::spawn(const std::vector<std::string>& argv,
                                                                    const SpawnOptions& options) {
    if (argv.empty()) return deoxidene::Err<std::string>("no program to start");
    SECURITY_ATTRIBUTES none{sizeof(SECURITY_ATTRIBUTES), nullptr, FALSE};
    HANDLE in_read, in_write, out_read, out_write;
    if (!CreatePipe(&in_read, &in_write, &none, 0)) return deoxidene::Err<std::string>("pipe failed");
    if (!CreatePipe(&out_read, &out_write, &none, 0)) {
        CloseHandle(in_read);
        CloseHandle(in_write);
        return deoxidene::Err<std::string>("pipe failed");
    }
    SetHandleInformation(in_write, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(out_read, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(in_read, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    SetHandleInformation(out_write, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    HANDLE error_read = nullptr;
    HANDLE error_inherit = nullptr;
    const HANDLE std_error = GetStdHandle(STD_ERROR_HANDLE);
    if (options.capture_stderr) {
        if (!CreatePipe(&error_read, &error_inherit, &none, 0)) {
            CloseHandle(in_read);
            CloseHandle(in_write);
            CloseHandle(out_read);
            CloseHandle(out_write);
            return deoxidene::Err<std::string>("pipe failed");
        }
        SetHandleInformation(error_read, HANDLE_FLAG_INHERIT, 0);
        SetHandleInformation(error_inherit, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    } else if (std_error && std_error != INVALID_HANDLE_VALUE) {
        DuplicateHandle(GetCurrentProcess(), std_error, GetCurrentProcess(), &error_inherit, 0, TRUE, DUPLICATE_SAME_ACCESS);
    }
    std::vector<HANDLE> inherited{in_read, out_write};
    if (error_inherit) inherited.push_back(error_inherit);
    SIZE_T attribute_size = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attribute_size);
    std::vector<unsigned char> attribute_storage(attribute_size);
    auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attribute_storage.data());
    InitializeProcThreadAttributeList(attributes, 1, 0, &attribute_size);
    UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited.data(),
                              inherited.size() * sizeof(HANDLE), nullptr, nullptr);
    std::wstring command;
    for (const auto& a : argv) {
        if (!command.empty()) command.push_back(L' ');
        command += quote_argument(widen(a));
    }
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof startup;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = in_read;
    startup.StartupInfo.hStdOutput = out_write;
    startup.StartupInfo.hStdError = error_inherit ? error_inherit : std_error;
    startup.lpAttributeList = attributes;
    PROCESS_INFORMATION process{};
    const std::wstring dir = options.cwd.wstring();
    std::wstring block = options.env.empty() ? std::wstring() : environment_block(options.env);
    DWORD flags = CREATE_NEW_PROCESS_GROUP | EXTENDED_STARTUPINFO_PRESENT;
    if (!block.empty()) flags |= CREATE_UNICODE_ENVIRONMENT;
    const BOOL ok = CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, flags,
                                   block.empty() ? nullptr : block.data(), dir.empty() ? nullptr : dir.c_str(),
                                   &startup.StartupInfo, &process);
    DeleteProcThreadAttributeList(attributes);
    CloseHandle(in_read);
    CloseHandle(out_write);
    if (error_inherit) CloseHandle(error_inherit);
    if (!ok) {
        CloseHandle(in_write);
        CloseHandle(out_read);
        if (error_read) CloseHandle(error_read);
        return deoxidene::Err<std::string>("cannot start " + argv[0]);
    }
    std::shared_ptr<Child> child(new Child());
    child->handles_ = std::make_unique<Handles>();
    child->handles_->process = process;
    child->handles_->input = in_write;
    child->handles_->output = out_read;
    child->handles_->error = error_read;
    child->own_group_ = options.own_group;
    return child;
}

Child::~Child() {
    close_input();
    if (handles_->output) CloseHandle(handles_->output);
    if (handles_->error) CloseHandle(handles_->error);
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

void Child::terminate() {
    close_input();
    kill();
}

std::optional<std::string> Child::read_error_chunk() {
    if (!handles_->error) return std::nullopt;
    char chunk[65536];
    DWORD n = 0;
    if (!ReadFile(handles_->error, chunk, sizeof chunk, &n, nullptr) || n == 0) return std::nullopt;
    return std::string(chunk, n);
}

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

#endif

}
