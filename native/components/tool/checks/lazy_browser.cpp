#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <map>
#include <regex>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace fs = std::filesystem;

CheckResult check_lazy_browser(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = fs::temp_directory_path() / ("gm-lazy-browser-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    fs::create_directories(workspace);
    auto count_playwriter = [](const std::vector<long long>& pids) {
        std::size_t count = 0;
        for (long long pid : pids) {
            std::string text;
            for (const std::string& part : proc::command_of(pid)) {
                if (!text.empty()) text += ' ';
                text += part;
            }
            if (text.find("playwriter") != std::string::npos) ++count;
        }
        return count;
    };
    const fs::path host = fs::path(binary).parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
    const fs::path source = build.parent_path().parent_path();
    const fs::path installed = sandbox / ".gmnew" / "current" / "gm";
    proc::SpawnOptions foreign_options(sandbox);
    foreign_options.own_group = true;
    const auto foreign_spawned = proc::Child::spawn({"sh", "-c", "sleep 300; true", "playwriter-project", (fs::temp_directory_path() / ("gm-foreign-gate-" + std::to_string(stamp))).string()}, foreign_options);
    const std::shared_ptr<proc::Child> foreign_gate = foreign_spawned ? *foreign_spawned : nullptr;
    if (!foreign_gate) result.failures.push_back("could not start the stand-in gate of another project");
    const long long foreign_pid = foreign_gate ? foreign_gate->pid() : 0;
    std::map<long long, long long> before;
    std::map<long long, long long> owned;
    std::vector<long long> reported;
    auto starts_now = [] {
        std::map<long long, long long> starts;
        for (const auto& row : proc::process_table()) starts[row.pid] = proc::start_time_of(row.pid);
        return starts;
    };
    auto fresh = [&before](long long pid) {
        const auto known = before.find(pid);
        return known == before.end() || known->second != proc::start_time_of(pid);
    };
    const auto install = proc::run({"env", "HOME=" + sandbox.string(), (host / "gm").string(), "install", "--local", build.string(), "--source", source.string()}, sandbox, {}, 900000);
    if (!install.started || install.exit_code != 0) result.failures.push_back("the sandbox install failed: " + (install.err.empty() ? install.out : install.err).substr(0, 400));
    const fs::path pin_marker = installed.parent_path() / "pw" / "gm-pin";
    std::ifstream pin_in(pin_marker);
    std::string pin_text;
    std::getline(pin_in, pin_text);
    if (pin_text != "df54652") result.failures.push_back("the install did not write the pin marker " + pin_marker.string() + " as df54652 (read '" + pin_text + "')");
    const fs::path entry = sandbox / ".gmnew" / "current" / "pw" / "bin" / "playwriter-project";
    if (!fs::exists(entry)) result.failures.push_back("the playwriter entry from defaults/mcp.json does not resolve under the install tree: " + entry.string());
    {
        Session session(installed.string(), workspace, sandbox, 180000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + installed.string());
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            const std::size_t at_start = count_playwriter(session.descendants());
            if (at_start != 0) result.failures.push_back("a fresh session started " + std::to_string(at_start) + " browser tooling process(es) before any use");
            const std::string verbs = session.body(
                "return JSON.stringify(gm.verbs().map((v) => v.name).filter((n) => n.startsWith('playwriter_')));");
            if (verbs.find("playwriter_execute") == std::string::npos)
                result.failures.push_back("the lazy browser verb playwriter_execute is missing from gm.verbs(): " + verbs.substr(0, 200));
            if (verbs.find("playwriter_reset") != std::string::npos) result.failures.push_back("the denied reset verb is listed");
            const std::size_t after_listing = count_playwriter(session.descendants());
            if (after_listing != 0) result.failures.push_back("listing the verbs started " + std::to_string(after_listing) + " browser tooling process(es)");
            before = starts_now();
            const std::string first_call = session.body("return JSON.stringify(await gm.playwriter_execute({ code: 'return 1;' }));");
            const std::regex launched("(?:gate pid|browser running pid) ([0-9]+)");
            for (auto it = std::sregex_iterator(first_call.begin(), first_call.end(), launched); it != std::sregex_iterator(); ++it)
                reported.push_back(std::stoll((*it)[1].str()));
            if (foreign_pid > 0) reported.push_back(foreign_pid);
            if (first_call.find("[return value] 1") == std::string::npos) result.failures.push_back("the first browser call did not run through the installed playwriter launcher: " + first_call.substr(0, 300));
            result.summary = "a fresh session has no browser tooling process; its verb playwriter_execute is listed without a start, and the first browser call runs through the launcher that a clean install placed under the sandbox HOME (playwriter_browsers is optional at the pin)";
        }
        const std::vector<long long> mine = session.descendants();
        std::vector<long long> roots = mine;
        for (const long long pid : reported) {
            if (fresh(pid)) roots.push_back(pid);
        }
        for (const long long pid : processes_mentioning(sandbox.string())) roots.push_back(pid);
        for (const long long pid : process_tree(roots)) {
            const long long start = proc::start_time_of(pid);
            const bool started_here = std::find(mine.begin(), mine.end(), pid) != mine.end() || fresh(pid);
            if (start > 0 && started_here) owned[pid] = start;
        }
        session.stop();
    }
    std::vector<long long> stopped;
    for (const auto& [pid, start] : owned) {
        if (proc::start_time_of(pid) == start) stopped.push_back(pid);
    }
    kill_processes(stopped);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    const auto survivors = alive_of(stopped);
    if (!survivors.empty()) {
        std::string ids;
        for (const long long pid : survivors) ids += (ids.empty() ? "" : " ") + std::to_string(pid);
        result.failures.push_back(std::to_string(survivors.size()) + " process(es) started by this check are still alive: " + ids);
    }
    if (foreign_gate) {
        if (alive_of({foreign_pid}).empty()) result.failures.push_back("this check stopped a gate that another project started: pid " + std::to_string(foreign_pid));
        foreign_gate->kill();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_lazy_browser(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
