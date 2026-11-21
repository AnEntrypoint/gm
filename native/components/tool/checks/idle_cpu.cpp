#include "gm/proc.hpp"
#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr long long kWindowMs = 8000;
constexpr long long kSettleMs = 2000;
constexpr double kCpuLimitPercent = 20.0;
constexpr double kWakeLimitPerSecond = 100.0;

long long ticks_of(long long pid) {
    std::ifstream in("/proc/" + std::to_string(pid) + "/stat");
    std::string text;
    std::getline(in, text, '\n');
    const std::size_t close = text.rfind(')');
    if (close == std::string::npos) return -1;
    std::istringstream fields(text.substr(close + 2));
    std::vector<std::string> names;
    for (std::string field; fields >> field;) names.push_back(field);
    if (names.size() < 13) return -1;
    return std::stoll(names[11]) + std::stoll(names[12]);
}

long long wakes_of(long long pid) {
    long long total = 0;
    std::error_code ec;
    for (const auto& task : fs::directory_iterator("/proc/" + std::to_string(pid) + "/task", ec)) {
        std::ifstream in(task.path() / "status");
        for (std::string line; std::getline(in, line);) {
            if (line.rfind("voluntary_ctxt_switches:", 0) == 0) total += std::stoll(line.substr(line.find(':') + 1));
        }
    }
    return total;
}

long long worker_of(long long serve) {
    for (const auto& row : proc::process_table()) {
        if (row.parent != serve || row.zombie) continue;
        for (const std::string& arg : proc::command_of(row.pid)) {
            if (arg.find("gm-core") != std::string::npos) return row.pid;
        }
    }
    return 0;
}

struct Load {
    double cpu = -1;
    double wakes = -1;
    double serve_wakes = -1;
    double body_seconds = -1;
    std::string reply;
    bool returned_one = false;
};

Load load_over(long long pid, long long serve, long long window_ms) {
    const long long ticks_before = ticks_of(pid);
    const long long wakes_before = wakes_of(pid);
    const long long serve_before = wakes_of(serve);
    const auto began = std::chrono::steady_clock::now();
    std::this_thread::sleep_for(std::chrono::milliseconds(window_ms));
    const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
    const long long ticks_after = ticks_of(pid);
    const long long wakes_after = wakes_of(pid);
    const long long serve_after = wakes_of(serve);
    Load load;
    if (ticks_before < 0 || ticks_after < 0 || seconds <= 0) return load;
    load.cpu = 100.0 * static_cast<double>(ticks_after - ticks_before) / 100.0 / seconds;
    load.wakes = static_cast<double>(wakes_after - wakes_before) / seconds;
    load.serve_wakes = static_cast<double>(serve_after - serve_before) / seconds;
    return load;
}

Load load_while(Session& session, long long worker, long long serve_pid, const std::string& body) {
    Load measured;
    std::thread measure([&] {
        std::this_thread::sleep_for(std::chrono::milliseconds(kSettleMs));
        measured = load_over(worker, serve_pid, kWindowMs);
    });
    const auto began = std::chrono::steady_clock::now();
    const std::string reply = session.body(body);
    const double body_seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
    measure.join();
    measured.body_seconds = body_seconds;
    measured.reply = reply.substr(0, 300);
    measured.returned_one = reply.find("[return value] 1") != std::string::npos;
    return measured;
}

void link_playwriter(const fs::path& home, std::string& failure) {
    const char* real_home = std::getenv("HOME");
    const fs::path installed = fs::path(real_home == nullptr ? "" : real_home) / ".gmnew" / "pw";
    std::error_code ec;
    if (real_home == nullptr || !fs::is_directory(installed, ec)) {
        failure = "no installed playwriter package at " + installed.string() + "; this check reuses it and never installs one";
        return;
    }
    fs::create_directories(home / ".gmnew", ec);
    fs::create_directory_symlink(installed, home / ".gmnew" / "pw", ec);
    if (ec) failure = "cannot link " + installed.string() + " into the sandbox: " + ec.message();
}

void stop_under(const fs::path& sandbox) {
    std::vector<std::string> argv{"kill", "-KILL"};
    for (const auto& row : proc::process_table()) {
        std::string joined;
        for (const std::string& arg : proc::command_of(row.pid)) joined += arg + " ";
        if (joined.find(sandbox.string()) != std::string::npos) argv.push_back(std::to_string(row.pid));
    }
    if (argv.size() > 2) proc::run(argv, sandbox, {}, 10000);
}

std::string text_of(const Load& load) {
    return std::to_string(load.cpu) + "% CPU, " + std::to_string(load.wakes) + " wakes/s (serve " + std::to_string(load.serve_wakes) + " wakes/s), body " + std::to_string(load.body_seconds) + " s reply " + load.reply;
}

}

CheckResult check_idle_cpu(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = fs::temp_directory_path() / ("gm-idle-cpu-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    const fs::path workspace = sandbox / "ws";
    std::error_code ec;
    fs::create_directories(workspace, ec);
    std::string playwriter_failure;
    link_playwriter(sandbox, playwriter_failure);
    if (!playwriter_failure.empty()) result.failures.push_back(playwriter_failure);
    {
        Session serve({binary, "serve", "--workspace", workspace.string(), "--run-dir", (workspace / "runs" / "idle").string()}, workspace, sandbox, 300000);
        if (!serve.started()) {
            result.failures.push_back("a gm serve did not start from " + binary);
        } else {
            initialize_session(serve, "gm-tool");
            serve.body("return 1;");
            const long long worker = worker_of(serve.pid());
            if (worker == 0) {
                result.failures.push_back("no gm-core worker under the serve");
            } else {
                const Load idle = load_over(worker, serve.pid(), kWindowMs);
                const Load shell = load_while(serve, worker, serve.pid(), "await gm.read_file({ path: 'skill://gm/SKILL.md' }); return await gm.run_shell({ command: 'sleep 12', timeoutMs: 30000 });");
                const Load timer = load_while(serve, worker, serve.pid(), "await gm.read_file({ path: 'skill://gm/SKILL.md' }); return await new Promise((resolve) => setTimeout(() => resolve('done'), 12000));");
                const Load playwriter = load_while(serve, worker, serve.pid(), "await gm.read_file({ path: 'skill://gm/SKILL.md' }); return JSON.stringify(await gm.playwriter_execute({ code: 'return 1;' }));");
                result.summary = "worker " + fs::read_symlink("/proc/" + std::to_string(worker) + "/exe", ec).string() + "; worker idle " + text_of(idle) + "; body waiting on run_shell " + text_of(shell) + "; body waiting on a timer " + text_of(timer) + "; body on playwriter_execute " + text_of(playwriter);
                if (idle.cpu > kCpuLimitPercent) result.failures.push_back("idle worker used " + std::to_string(idle.cpu) + "% CPU");
                if (shell.cpu > kCpuLimitPercent) result.failures.push_back("worker waiting on run_shell used " + std::to_string(shell.cpu) + "% CPU");
                if (timer.cpu > kCpuLimitPercent) result.failures.push_back("worker waiting on a timer used " + std::to_string(timer.cpu) + "% CPU");
                if (timer.wakes > kWakeLimitPerSecond) result.failures.push_back("worker waiting on a timer woke " + std::to_string(timer.wakes) + " times per second");
                if (playwriter.cpu > kCpuLimitPercent) result.failures.push_back("worker during playwriter_execute used " + std::to_string(playwriter.cpu) + "% CPU");
                if (playwriter.wakes > kWakeLimitPerSecond) result.failures.push_back("worker during playwriter_execute woke " + std::to_string(playwriter.wakes) + " times per second");
                if (!playwriter.returned_one) result.failures.push_back("playwriter_execute did not return 1: " + playwriter.reply);
            }
        }
        serve.stop();
    }
    stop_under(sandbox);
    fs::remove_all(sandbox, ec);
    if (result.summary.empty()) result.summary = "no measurement";
    if (!result.failures.empty()) result.failures.insert(result.failures.begin(), "readings: " + result.summary);
    return result;
}

}
