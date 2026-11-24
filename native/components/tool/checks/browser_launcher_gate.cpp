#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
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

struct StartedGate {
    long long gate_pid = 0;
    long long browser_pid = 0;
    long long browser_started = 0;
    int port = 0;
    std::string status;
};

using LauncherRun = std::function<proc::Outcome(const std::string&, int)>;

CheckResult with_started_gate(const std::string& label, const std::vector<std::string>& extra_env, const std::function<void(const StartedGate&, const LauncherRun&, const fs::path&, CheckResult&)>& body) {
    CheckResult result;
    const std::string chromium = chromium_binary();
    if (chromium.empty()) {
        result.failures.push_back("no Chromium: set PLAYWRITER_BROWSER_PATH, or install one at /opt/google/chrome/chrome, /usr/lib/chromium/chromium.real or on PATH");
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-" + label + "-" + std::to_string(stamp % 1000000));
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
    std::vector<std::string> env{"env", "HOME=" + sandbox.string(), "PLAYWRITER_PROJECT_DIR=" + workspace.string(), "PLAYWRITER_TELEMETRY=0", "PLAYWRITER_IDLE_MS=60000", "PLAYWRITER_NO_SANDBOX=1", "PLAYWRITER_BROWSER_PATH=" + chromium};
    env.insert(env.end(), extra_env.begin(), extra_env.end());
    env.push_back("node");
    env.push_back(launcher.string());
    const LauncherRun launcher_run = [&](const std::string& argument, int timeout_ms) {
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
        StartedGate gate;
        gate.status = launcher_run("status", 30000).out;
        gate.gate_pid = pid_after(gate.status, "gate pid");
        gate.port = static_cast<int>(pid_after(gate.status, "gate pid [0-9]+ port"));
        gate.browser_pid = pid_after(gate.status, "browser running pid");
        gate.browser_started = proc::start_time_of(gate.browser_pid);
        if (gate.gate_pid != 0) roots.push_back(gate.gate_pid);
        if (gate.browser_pid != 0) roots.push_back(gate.browser_pid);
        if (gate.gate_pid == 0 || gate.port == 0 || gate.browser_pid == 0 || gate.browser_started <= 0) {
            result.failures.push_back("the status of the started gate names no gate pid, port or browser pid: " + gate.status.substr(0, 300));
        } else {
            body(gate, launcher_run, workspace, result);
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

CheckResult check_browser_second_gate(const std::string&) {
    return with_started_gate("second-gate", {}, [](const StartedGate& gate, const LauncherRun& launcher_run, const fs::path& workspace, CheckResult& result) {
        const auto second = launcher_run("--gate", 60000);
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        if (second.timed_out) result.failures.push_back("a second gate on the same ports did not exit within 60 s");
        const bool browser_alive = proc::start_time_of(gate.browser_pid) == gate.browser_started;
        const bool gate_alive = proc::start_time_of(gate.gate_pid) > 0;
        if (!browser_alive) result.failures.push_back("a second gate that could not listen on the project's port stopped the browser of the first gate (pid " + std::to_string(gate.browser_pid) + "); the gate log says: " + read_text(workspace / ".playwriter" / "gate.log").substr(0, 600));
        if (!gate_alive) result.failures.push_back("the first gate (pid " + std::to_string(gate.gate_pid) + ") was gone after a second gate failed to listen");
        if (result.failures.empty()) result.summary = "a second gate that cannot listen on the project's port exits and leaves the first gate and its browser (pid " + std::to_string(gate.browser_pid) + ") running";
    });
}

CheckResult check_browser_ws_address(const std::string&) {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path preload = fs::temp_directory_path() / ("gm-no-fetch-" + std::to_string(stamp % 1000000) + ".js");
    {
        std::ofstream out(preload);
        out << "const real = globalThis.fetch;\nglobalThis.fetch = (url, options) => String(url).includes('/json/version') ? Promise.reject(new TypeError('fetch failed')) : real(url, options);\n";
    }
    CheckResult result = with_started_gate("ws-address", {"NODE_OPTIONS=--require=" + preload.string()}, [](const StartedGate& gate, const LauncherRun&, const fs::path& workspace, CheckResult& inner) {
        const std::string script =
            "const http = require('http');"
            "const request = http.request({ host: '127.0.0.1', port: Number(process.argv[1]), path: '/devtools/browser/x', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });"
            "request.on('upgrade', (response, socket) => { console.log('upgrade ' + response.statusCode); socket.destroy(); });"
            "request.on('response', (response) => { let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => console.log('response ' + response.statusCode + ' ' + body)); });"
            "request.on('error', (error) => console.log('error ' + error.message));"
            "request.end();";
        const auto reply = proc::run({"node", "-e", script, std::to_string(gate.port)}, workspace, {}, 60000);
        if (reply.out.find("upgrade 101") == std::string::npos) {
            inner.failures.push_back("a websocket upgrade through the gate was not passed to the browser while the gate's fetch is broken: " + reply.out.substr(0, 400) + "; the gate log says: " + support::tail_of(read_text(workspace / ".playwriter" / "gate.log"), 600));
        } else {
            inner.summary = "the gate finds the browser's websocket address without fetch: an upgrade through port " + std::to_string(gate.port) + " reached the browser (101) while fetch of /json/version was made to fail";
        }
    });
    std::error_code ec;
    fs::remove(preload, ec);
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

CheckResult check_browser_ws_address(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
