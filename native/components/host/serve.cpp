#include <csignal>
#include <cstring>
#include <ctime>
#include <iostream>

#if defined(_WIN32)
#include <process.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

#include "gm/host/child.hpp"
#include "gm/host/options.hpp"
#include "gm/host/relay.hpp"
#include "gm/host/update.hpp"
#include "gm/json.hpp"
#include "gm/mcp.hpp"

namespace gm::host {

namespace {

std::filesystem::path worker_executable(const std::filesystem::path& install_dir) {
    std::error_code ec;
    const std::filesystem::path core = install_dir / core_executable_name();
    return std::filesystem::exists(core, ec) ? core : current_executable();
}

std::string relay_process_id() { return gm::mcp::process_identity(); }

#if !defined(_WIN32)
int relay_log_fd = -1;

struct NamedSignal {
    int number;
    const char* text;
    bool crash;
};

constexpr NamedSignal kReportedSignals[] = {
    {SIGHUP, "gm relay: stopped by SIGHUP\n", false},     {SIGINT, "gm relay: stopped by SIGINT\n", false},
    {SIGTERM, "gm relay: stopped by SIGTERM\n", false},   {SIGQUIT, "gm relay: stopped by SIGQUIT\n", false},
    {SIGUSR1, "gm relay: stopped by SIGUSR1\n", false},   {SIGALRM, "gm relay: stopped by SIGALRM\n", false},
    {SIGXCPU, "gm relay: stopped by SIGXCPU\n", false},   {SIGXFSZ, "gm relay: stopped by SIGXFSZ\n", false},
    {SIGVTALRM, "gm relay: stopped by SIGVTALRM\n", false}, {SIGPROF, "gm relay: stopped by SIGPROF\n", false},
#if !defined(__SANITIZE_ADDRESS__)
    {SIGSEGV, "gm relay: crashed with SIGSEGV\n", true},  {SIGBUS, "gm relay: crashed with SIGBUS\n", true},
    {SIGABRT, "gm relay: crashed with SIGABRT\n", true},  {SIGFPE, "gm relay: crashed with SIGFPE\n", true},
    {SIGILL, "gm relay: crashed with SIGILL\n", true},    {SIGTRAP, "gm relay: crashed with SIGTRAP\n", true},
    {SIGSYS, "gm relay: crashed with SIGSYS\n", true},
#endif
};

void report_stop(int signal) {
    const char* text = "gm relay: stopped by a signal\n";
    bool crash = false;
    for (const NamedSignal& named : kReportedSignals) {
        if (named.number == signal) {
            text = named.text;
            crash = named.crash;
        }
    }
    if (relay_log_fd >= 0) {
        timespec now{};
        ::clock_gettime(CLOCK_REALTIME, &now);
        unsigned long long ms = static_cast<unsigned long long>(now.tv_sec) * 1000ULL + static_cast<unsigned long long>(now.tv_nsec / 1000000);
        char line[96];
        char digits[24];
        std::size_t count = 0;
        do {
            digits[count++] = static_cast<char>('0' + ms % 10);
            ms /= 10;
        } while (ms != 0);
        std::size_t length = 0;
        while (count > 0) line[length++] = digits[--count];
        line[length++] = ' ';
        const std::size_t text_length = std::strlen(text);
        std::memcpy(line + length, text, text_length);
        length += text_length;
        [[maybe_unused]] const ssize_t logged = ::write(relay_log_fd, line, length);
    }
    [[maybe_unused]] const ssize_t written = ::write(STDERR_FILENO, text, std::strlen(text));
    if (crash) {
        std::signal(signal, SIG_DFL);
        ::raise(signal);
    }
    if (crash || stop_signal_received != 0) ::_exit(128 + signal);
    stop_signal_received = signal;
}
#endif

}

int run_serve(const HostArgs& args) {
    auto max_inflight = positive_int_flag(args, "--max-inflight", mcp::ServerOptions{}.max_inflight);
    if (!max_inflight) {
        std::cerr << "gm relay: " << max_inflight.error() << '\n';
        return 1;
    }
    if (auto protocol = switch_flag(args, "--protocol-2026-07-28"); !protocol) {
        std::cerr << "gm relay: " << protocol.error() << '\n';
        return 1;
    }
    const auto workspace = workspace_of(args);
    if (!std::filesystem::is_directory(workspace)) {
        std::cerr << "gm relay: workspace is not a directory: " << workspace.string() << '\n';
        return 1;
    }
    if (auto task = task_of(args); !task) {
        std::cerr << "gm relay: " << task.error() << '\n';
        return 1;
    }
    auto run_dir = choose_run_dir(args, workspace);
    if (!run_dir) {
        std::cerr << "gm relay: " << run_dir.error() << '\n';
        return 1;
    }
    const std::filesystem::path run_log = *run_dir / "relay.log";
    std::error_code dir_ec;
    std::filesystem::create_directories(*run_dir, dir_ec);
#if !defined(_WIN32)
    relay_log_fd = ::open(run_log.c_str(), O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0644);
#endif
    append_run_log(run_log, "started " + relay_process_id());
    const std::filesystem::path install_dir = current_executable().parent_path();
    RelayOptions options;
    options.run_log = run_log;
    options.worker_argv = {worker_executable(install_dir).string(), "worker"};
    for (std::string& arg : without_flags(args.rest, {"--runs", "--resume", "--run-dir", "--workspace", "--supervised", "--owner", "--resend", "--from-build"}))
        options.worker_argv.push_back(std::move(arg));
    options.worker_argv.insert(options.worker_argv.end(), {"--workspace", workspace.string(), "--run-dir",
                                                           run_dir->string(), "--supervised", "yes", "--owner",
                                                           relay_process_id()});
    options.reexec_argv = {stable_executable(current_executable()).string(), "serve"};
    for (std::string& arg : without_flags(args.rest, {"--runs", "--resume", "--run-dir", "--workspace", "--handshake", "--skill-read", "--resend", "--from-build"}))
        options.reexec_argv.push_back(std::move(arg));
    options.reexec_argv.insert(options.reexec_argv.end(), {"--workspace", workspace.string(), "--run-dir",
                                                           run_dir->string()});
    if (const auto handshake = args.flag("--handshake")) {
        if (auto parsed = json::parse(*handshake)) options.initialize = std::move(*parsed);
    }
    if (const auto resend = args.flag("--resend")) {
        if (auto parsed = json::parse(*resend); parsed && parsed->is_array()) {
            for (const json::Value& line : parsed->as_array()) {
                if (line.is_string()) options.resend.push_back(line.as_string());
            }
        }
    }
    const auto skill_read = args.flag("--skill-read");
    options.skill_read = skill_read && *skill_read == "yes";
    if (const auto from_build = args.flag("--from-build")) options.from_build = *from_build;
    options.build_dir = args.path_or("--build-dir", {});
    options.runtime_roots = {leaves_dir_of(args)};
    options.update = policy_from_environment(install_dir);
#if !defined(_WIN32)
    for (const NamedSignal& named : kReportedSignals) std::signal(named.number, report_stop);
#endif
    const int code = serve_stdio(std::move(options));
    append_run_log(run_log, "relay exited with code " + std::to_string(code));
    return code;
}

}
