#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <map>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

std::string execute(Session& session, const std::string& code) {
    return session.body("return JSON.stringify(await gm.playwriter_execute({ code: " + json::dump(json::Value(code)) + " }));");
}

}

CheckResult check_browser_feedback(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-browser-feedback-" + std::to_string(stamp % 1000000));
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
    if (!contains(read_text(launcher), "SCAN_TIME_PATTERN") || !contains(read_text(launcher), "WAIT_HINT_MS")) {
        result.failures.push_back("the installed launcher " + installed_pw.string() + " lacks the listing and fixed-wait patches (defaults/playwriter/launcher-feedback.diff and launcher-wait-hint.diff); gm install applies them");
        fs::remove_all(sandbox, ec);
        return result;
    }
    std::map<long long, long long> before;
    for (const auto& row : proc::process_table()) before[row.pid] = proc::start_time_of(row.pid);
    auto fresh = [&before](long long pid) {
        const auto known = before.find(pid);
        return known == before.end() || known->second != proc::start_time_of(pid);
    };
    std::vector<long long> mine;
    {
        Session session(binary, workspace, sandbox, 180000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            initialize_session(session, "gm-tool");
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            auto expect = [&](bool condition, const std::string& what) {
                if (!condition) result.failures.push_back(what);
            };
            const std::string first = execute(session, "state.p = await context.newPage(); await state.p.goto('data:text/html,<title>feedback-one</title>'); return 'first';");
            expect(first.find("feedback-one") != std::string::npos && first.find("browsers:") != std::string::npos, "the first call did not list the open pages: " + first.substr(0, 400));
            execute(session, "return 'warm';");
            const std::string same = execute(session, "await state.p.waitForTimeout(2500); return 'same';");
            expect(same.find("browsers:") == std::string::npos && same.find("feedback-one") == std::string::npos && same.find("gate pid") != std::string::npos,
                   "a call after which no page changed repeated the page list or lost the gate line: " + same.substr(0, 400));
            const std::string changed = execute(session, "await state.p.evaluate(() => { document.title = 'feedback-two'; }); await state.p.waitForTimeout(2500); return 'changed';");
            expect(changed.find("feedback-two") != std::string::npos, "a call that changed a page title did not list the pages again: " + changed.substr(0, 900));
            const std::string slept = execute(session, "await state.p.waitForTimeout(5200); return 'slept';");
            expect(slept.find("waitForFunction") != std::string::npos && slept.find("5200 ms") != std::string::npos, "a call with a fixed wait of 5200 ms did not carry the early-return hint: " + slept.substr(0, 400));
            const std::string again = execute(session, "await state.p.waitForTimeout(5200); return 'slept again';");
            expect(again.find("waitForFunction") == std::string::npos, "the fixed-wait hint was repeated on a second call");
            const std::string quick = execute(session, "await state.p.waitForTimeout(300); return 'quick';");
            expect(quick.find("waitForFunction") == std::string::npos, "a short wait carried the hint");
            mine = session.descendants();
        }
        session.stop();
    }
    std::vector<long long> roots = mine;
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
    if (result.failures.empty()) result.summary = "a browser call lists the open pages once and not again until a page changes (the scan time does not count), and a call that sleeps 5 s or more in waitForTimeout carries the early-return hint once";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_browser_feedback(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
