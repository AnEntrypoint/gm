#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <map>
#include <regex>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

constexpr int kQuietMs = 7000;
const char* const kCreate = "return JSON.stringify(await gm.playwriter_execute({ code: \"state.real = await context.newPage(); await state.real.goto('data:text/html,<title>real</title>'); state.blank = await context.newPage(); return 'READY ' + state.blank.url();\" }));";
const char* const kProbe = "return JSON.stringify(await gm.playwriter_execute({ code: \"return state.blank.isClosed() ? 'BLANK CLOSED' : 'BLANK KEPT';\" }));";

}

CheckResult check_browser_blank_grace(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-blank-grace-" + std::to_string(stamp % 1000000));
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
    if (!contains(read_text(launcher), "BLANK_GRACE_MS")) {
        result.failures.push_back("the installed launcher " + installed_pw.string() + " lacks the blank-tab grace patch (defaults/playwriter/launcher-blank-grace.diff); gm install applies it");
        fs::remove_all(sandbox, ec);
        return result;
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
        Session session(binary, workspace, sandbox, 180000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            initialize_session(session, "gm-tool");
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            const std::string created = session.body(kCreate);
            const std::size_t own_line = created.find(workspace.string() + ": gate pid");
            const std::size_t line_end = own_line == std::string::npos ? std::string::npos : created.find("leases", own_line);
            const std::string line = line_end == std::string::npos ? std::string() : created.substr(own_line, line_end - own_line);
            const std::regex launched("(?:gate pid|browser running pid) ([0-9]+)");
            for (auto it = std::sregex_iterator(line.begin(), line.end(), launched); it != std::sregex_iterator(); ++it) reported.push_back(std::stoll((*it)[1].str()));
            if (created.find("READY about:blank") == std::string::npos) result.failures.push_back("the blank page was not created beside a real page: " + cause_of(created));
            std::this_thread::sleep_for(std::chrono::milliseconds(kQuietMs));
            const std::string probed = session.body(kProbe);
            if (probed.find("BLANK KEPT") == std::string::npos)
                result.failures.push_back("a page created blank beside a real page was closed by the gate within " + std::to_string(kQuietMs) + " ms, before its navigation could start: " + probed.substr(0, 300));
            mine = session.descendants();
        }
        session.stop();
    }
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
    if (!survivors.empty()) result.failures.push_back(std::to_string(survivors.size()) + " process(es) started by this check are still alive");
    fs::remove_all(sandbox, ec);
    result.summary = "a page created blank beside a real page is still open " + std::to_string(kQuietMs) + " ms later, so the gate's blank-tab sweep cannot close it under a pending navigation";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_browser_blank_grace(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
