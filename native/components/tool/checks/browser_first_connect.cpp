#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

const char* const kOpenPage = "return JSON.stringify(await gm.playwriter_execute({ code: \"state.page = await context.newPage(); await state.page.goto('data:text/html,<title>first</title>'); return 'opened';\" }));";

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

std::size_t lines_in(const fs::path& file) {
    std::ifstream in(file);
    std::size_t count = 0;
    for (std::string line; std::getline(in, line);) ++count;
    return count;
}

}

CheckResult check_browser_first_connect(const std::string& binary) {
    CheckResult result;
    const std::string chromium = chromium_binary();
    if (chromium.empty()) {
        result.failures.push_back("no Chromium: set PLAYWRITER_BROWSER_PATH, or install one at /opt/google/chrome/chrome, /usr/lib/chromium/chromium.real or on PATH");
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-first-connect-" + std::to_string(stamp % 1000000));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    const char* home = std::getenv("HOME");
    const fs::path installed_pw = fs::path(home == nullptr ? "" : home) / ".gmnew" / "pw";
    std::error_code ec;
    fs::create_directories(sandbox / ".gmnew", ec);
    fs::create_directory_symlink(installed_pw, sandbox / ".gmnew" / "pw", ec);
    if (ec || !fs::exists(sandbox / ".gmnew" / "pw" / "bin" / "playwriter-project")) {
        result.failures.push_back("no installed playwriter launcher to reuse at " + installed_pw.string());
        fs::remove_all(sandbox, ec);
        return result;
    }
    const fs::path starts = sandbox / "starts.log";
    const fs::path wrapper = sandbox / "flaky-browser";
    support::write_script(wrapper, "#!/bin/sh\necho start >> '" + starts.string() + "'\nif [ \"$(wc -l < '" + starts.string() + "')\" -le 1 ]; then echo 'simulated first start failure' >&2; exit 1; fi\nexec '" + chromium + "' \"$@\"\n");
    fs::permissions(wrapper, fs::perms::owner_all, fs::perm_options::replace, ec);

    std::map<long long, long long> before;
    for (const auto& row : proc::process_table()) before[row.pid] = proc::start_time_of(row.pid);
    auto fresh = [&before](long long pid) {
        const auto known = before.find(pid);
        return known == before.end() || known->second != proc::start_time_of(pid);
    };
    std::vector<long long> mine;
    {
        Session session(binary, workspace, sandbox, 180000, false, {}, {{"PLAYWRITER_BROWSER_PATH", wrapper.string()}, {"PLAYWRITER_NO_SANDBOX", "1"}});
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            initialize_session(session, "gm-tool");
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            const std::string opened = session.body(kOpenPage);
            if (opened.find("opened") == std::string::npos) result.failures.push_back("the first call, whose first browser start failed, was not sent again and did not open its page: " + opened.substr(0, 1200));
            if (lines_in(starts) < 2) result.failures.push_back("the browser was started " + std::to_string(lines_in(starts)) + " time(s); the first start was meant to fail and a second one to succeed");
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
    if (result.failures.empty()) result.summary = "a browser call whose first browser start failed (the launcher answers 503 and the executor's connect fails before any body runs) is sent again and opens its page on the second start";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_browser_first_connect(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
