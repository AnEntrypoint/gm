#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <fstream>
#include <map>
#include <regex>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

std::string chromium_binary() {
    if (const char* given = std::getenv("PLAYWRITER_BROWSER_PATH"); given && fs::exists(given)) return given;
    for (const char* candidate : {"/opt/google/chrome/chrome", "/usr/lib/chromium/chromium.real", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"}) {
        if (fs::exists(candidate)) return candidate;
    }
    const char* path_env = std::getenv("PATH");
    std::istringstream dirs(path_env ? path_env : "");
    for (std::string dir; std::getline(dirs, dir, ':');) {
        for (const char* name : {"google-chrome", "google-chrome-stable", "chromium", "chromium-browser"}) {
            if (!dir.empty() && fs::exists(fs::path(dir) / name)) return (fs::path(dir) / name).string();
        }
    }
    return {};
}

long long pid_after(const std::string& text, const std::string& label) {
    std::smatch found;
    return std::regex_search(text, found, std::regex(label + " ([0-9]+)")) ? std::stoll(found[1].str()) : 0;
}

}

CheckResult check_browser_second_gate(const std::string&) {
    CheckResult result;
    const std::string chromium = chromium_binary();
    if (chromium.empty()) {
        result.failures.push_back("no Chromium: set PLAYWRITER_BROWSER_PATH, or install one at /opt/google/chrome/chrome, /usr/lib/chromium/chromium.real or on PATH");
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-second-gate-" + std::to_string(stamp % 1000000));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    const char* home = std::getenv("HOME");
    const fs::path installed_pw = fs::path(home == nullptr ? "" : home) / ".gmnew" / "pw";
    std::error_code ec;
    fs::create_directories(sandbox / ".gmnew", ec);
    fs::create_directory_symlink(installed_pw, sandbox / ".gmnew" / "pw", ec);
    const fs::path launcher = sandbox / ".gmnew" / "pw" / "bin" / "playwriter-project";
    if (ec || !fs::exists(launcher)) {
        result.failures.push_back("no installed playwriter launcher to reuse at " + installed_pw.string());
        fs::remove_all(sandbox, ec);
        return result;
    }
    if (!contains(read_text(launcher), "keepBrowser: true")) {
        result.failures.push_back("the installed launcher " + installed_pw.string() + " lacks the listen-failure patch (defaults/playwriter/launcher-listen-failure.diff); gm install applies it");
        fs::remove_all(sandbox, ec);
        return result;
    }
    const std::vector<std::string> env{"env", "HOME=" + sandbox.string(), "PLAYWRITER_PROJECT_DIR=" + workspace.string(), "PLAYWRITER_TELEMETRY=0", "PLAYWRITER_IDLE_MS=60000", "PLAYWRITER_NO_SANDBOX=1", "PLAYWRITER_BROWSER_PATH=" + chromium, "node", launcher.string()};
    auto launcher_run = [&](const std::string& argument, int timeout_ms) {
        std::vector<std::string> argv = env;
        argv.push_back(argument);
        return proc::run(argv, workspace, {}, timeout_ms);
    };
    std::map<long long, long long> before;
    for (const auto& row : proc::process_table()) before[row.pid] = proc::start_time_of(row.pid);
    auto fresh = [&before](long long pid) {
        const auto known = before.find(pid);
        return known == before.end() || known->second != proc::start_time_of(pid);
    };
    std::vector<long long> roots;
    const auto started = launcher_run("start", 120000);
    if (!started.started || started.exit_code != 0 || started.err.find("browser ready") == std::string::npos) {
        result.failures.push_back("start did not report a ready browser: " + started.err.substr(0, 300));
    } else {
        const std::string status = launcher_run("status", 30000).out;
        const long long gate_pid = pid_after(status, "gate pid");
        const long long browser_pid = pid_after(status, "browser running pid");
        const long long browser_started = proc::start_time_of(browser_pid);
        if (gate_pid != 0) roots.push_back(gate_pid);
        if (browser_pid != 0) roots.push_back(browser_pid);
        if (gate_pid == 0 || browser_pid == 0 || browser_started <= 0) {
            result.failures.push_back("the status of the started gate names no gate pid or browser pid: " + status.substr(0, 300));
        } else {
            const auto second = launcher_run("--gate", 60000);
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            if (second.timed_out) result.failures.push_back("a second gate on the same ports did not exit within 60 s");
            const bool browser_alive = proc::start_time_of(browser_pid) == browser_started;
            const bool gate_alive = proc::start_time_of(gate_pid) > 0;
            if (!browser_alive) result.failures.push_back("a second gate that could not listen on the project's port stopped the browser of the first gate (pid " + std::to_string(browser_pid) + "); the gate log says: " + read_text(workspace / ".playwriter" / "gate.log").substr(0, 600));
            if (!gate_alive) result.failures.push_back("the first gate (pid " + std::to_string(gate_pid) + ") was gone after a second gate failed to listen");
            if (result.failures.empty()) result.summary = "a second gate that cannot listen on the project's port exits and leaves the first gate and its browser (pid " + std::to_string(browser_pid) + ") running";
        }
    }
    for (const long long pid : processes_mentioning(sandbox.string())) roots.push_back(pid);
    std::vector<long long> stopped;
    for (const long long pid : process_tree(roots)) {
        if (proc::start_time_of(pid) > 0 && fresh(pid)) stopped.push_back(pid);
    }
    kill_processes(stopped);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    const auto survivors = alive_of(stopped);
    if (!survivors.empty()) result.failures.push_back(std::to_string(survivors.size()) + " process(es) started by this check are still alive");
    fs::remove_all(sandbox, ec);
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_browser_second_gate(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
