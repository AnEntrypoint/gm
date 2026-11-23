#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <map>
#include <regex>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

constexpr long long kHourMs = 3600000;
constexpr long long kControlIdleMs = 8000;
const char* const kOpenPage = "return JSON.stringify(await gm.playwriter_execute({ code: \"state.page = await context.newPage(); await state.page.goto('data:text/html,<title>signin</title>'); return 'opened';\" }));";

std::string default_idle(const std::string& binary) {
    auto parsed = json::parse(read_text(fs::path(binary).parent_path() / "defaults" / "mcp.json"));
    if (!parsed) return "";
    const json::Value* servers = parsed->find("mcpServers");
    const json::Value* entry = servers == nullptr ? nullptr : servers->find("playwriter");
    const json::Value* defaults = entry == nullptr ? nullptr : entry->find("envDefaults");
    const json::Value* idle = defaults == nullptr ? nullptr : defaults->find("PLAYWRITER_IDLE_MS");
    return idle != nullptr && idle->is_string() ? idle->as_string() : "";
}

struct Case {
    std::string gate_log;
    std::string status;
    std::vector<std::string> failures;
};

Case run_case(const std::string& binary, const std::string& label, const std::vector<std::pair<std::string, std::string>>& env, std::int64_t quiet_ms) {
    Case outcome;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-idle-" + label + "-" + std::to_string(stamp % 1000000));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    const char* home = std::getenv("HOME");
    const fs::path installed_pw = fs::path(home == nullptr ? "" : home) / ".gmnew" / "pw";
    std::error_code ec;
    fs::create_directories(sandbox / ".gmnew", ec);
    fs::create_directory_symlink(installed_pw, sandbox / ".gmnew" / "pw", ec);
    const fs::path launcher = sandbox / ".gmnew" / "pw" / "bin" / "playwriter-project";
    if (ec || !fs::exists(launcher)) {
        outcome.failures.push_back(label + ": no installed playwriter launcher to reuse at " + installed_pw.string());
        fs::remove_all(sandbox, ec);
        return outcome;
    }
    std::map<long long, long long> before;
    for (const auto& row : proc::process_table()) before[row.pid] = proc::start_time_of(row.pid);
    auto fresh = [&before](long long pid) {
        const auto known = before.find(pid);
        return known == before.end() || known->second != proc::start_time_of(pid);
    };
    std::vector<long long> reported;
    std::vector<long long> mine;
    {
        Session session(binary, workspace, sandbox, 180000, false, {}, env);
        if (!session.started()) {
            outcome.failures.push_back(label + ": gm serve did not start from " + binary);
        } else {
            initialize_session(session, "gm-tool");
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            const std::string opened = session.body(kOpenPage);
            const std::regex launched("(?:gate pid|browser running pid) ([0-9]+)");
            const std::size_t own_line = opened.find(workspace.string() + ": gate pid");
            const std::size_t line_end = own_line == std::string::npos ? std::string::npos : opened.find("leases", own_line);
            const std::string line = line_end == std::string::npos ? std::string() : opened.substr(own_line, line_end - own_line);
            for (auto it = std::sregex_iterator(line.begin(), line.end(), launched); it != std::sregex_iterator(); ++it) reported.push_back(std::stoll((*it)[1].str()));
            if (opened.find("opened") == std::string::npos) outcome.failures.push_back(label + ": a page did not open through the launcher: " + opened.substr(0, 1500));
            mine = session.descendants();
        }
        session.stop();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(quiet_ms));
    const auto status = proc::run({"env", "HOME=" + sandbox.string(), "PLAYWRITER_PROJECT_DIR=" + workspace.string(), "node", launcher.string(), "status"}, workspace, {}, 60000);
    outcome.status = status.out + status.err;
    outcome.gate_log = read_text(workspace / ".playwriter" / "gate.log");
    std::vector<long long> roots = mine;
    for (const long long pid : reported) roots.push_back(pid);
    for (const long long pid : processes_mentioning(sandbox.string())) roots.push_back(pid);
    std::vector<long long> stopped;
    for (const long long pid : process_tree(roots)) {
        if (proc::start_time_of(pid) > 0 && fresh(pid)) stopped.push_back(pid);
    }
    kill_processes(stopped);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    const auto survivors = alive_of(stopped);
    if (!survivors.empty()) outcome.failures.push_back(label + ": " + std::to_string(survivors.size()) + " process(es) started by this check are still alive");
    fs::remove_all(sandbox, ec);
    return outcome;
}

}

CheckResult check_browser_idle_default(const std::string& binary) {
    CheckResult result;
    const std::string idle = default_idle(binary);
    const long long idle_ms = idle.empty() ? 0 : std::stoll(idle);
    if (idle_ms < kHourMs) {
        result.failures.push_back("defaults/mcp.json envDefaults.PLAYWRITER_IDLE_MS is '" + idle + "': a browser that a person signs in to needs at least " + std::to_string(kHourMs) + " ms of idle time");
        return result;
    }
    const Case held = run_case(binary, "held", {}, 15000);
    for (const std::string& failure : held.failures) result.failures.push_back(failure);
    if (!contains(held.gate_log, "idle " + idle + "ms")) result.failures.push_back("the gate did not take the default idle time " + idle + " ms from the entry; gate log: " + held.gate_log.substr(0, 300));
    if (contains(held.gate_log, "stopping browser")) result.failures.push_back("the browser stopped during a quiet stretch with a page open and the default idle time; gate log: " + held.gate_log.substr(0, 400));
    if (!contains(held.gate_log, "keeps the browser up")) result.failures.push_back("the gate never reported that an open page keeps the browser up after the last lease ended; gate log: " + held.gate_log.substr(0, 400));
    if (!contains(held.status, "browser running pid")) result.failures.push_back("status does not show a running browser after the quiet stretch: " + held.status.substr(0, 300));
    const Case control = run_case(binary, "control", {{"PLAYWRITER_IDLE_MS", std::to_string(kControlIdleMs)}}, 20000);
    for (const std::string& failure : control.failures) result.failures.push_back(failure);
    if (!contains(control.gate_log, "idle " + std::to_string(kControlIdleMs) + "ms")) result.failures.push_back("an explicit PLAYWRITER_IDLE_MS did not take the place of the default; gate log: " + control.gate_log.substr(0, 300));
    if (!contains(control.gate_log, "stopping browser: idle")) result.failures.push_back("with a short idle time the browser was not stopped for idleness, so the idle time is not what decides; gate log: " + control.gate_log.substr(0, 400));
    result.summary = "the default entry hands PLAYWRITER_IDLE_MS " + idle + " to the gate; a page left open with no lease and no traffic for 15 s keeps the browser up, and the same start with PLAYWRITER_IDLE_MS " + std::to_string(kControlIdleMs) + " stops it for idleness";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_browser_idle_default(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
