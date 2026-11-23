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

CheckResult check_browser_start_reason(const std::string& binary) {
    CheckResult result;
    const std::string chromium = chromium_binary();
    if (chromium.empty()) {
        result.failures.push_back("no Chromium: set PLAYWRITER_BROWSER_PATH, or install one at /opt/google/chrome/chrome, /usr/lib/chromium/chromium.real or on PATH");
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-start-reason-" + std::to_string(stamp % 1000000));
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
    if (!contains(read_text(sandbox / ".gmnew" / "pw" / "bin" / "playwriter-project"), "START_REASON_CHARS")) {
        result.failures.push_back("the installed launcher lacks the start-reason patch (defaults/playwriter/launcher-start-reason.diff); gm install applies it");
        fs::remove_all(sandbox, ec);
        return result;
    }
    const fs::path starts = sandbox / "starts.log";
    const fs::path wrapper = sandbox / "crashing-browser";
    support::write_script(wrapper, std::string("#!/bin/sh\necho start >> '") + starts.string() + "'\ni=0\nwhile [ $i -lt 120 ]; do echo \"noise-line-$i padding padding padding\"; i=$((i+1)); done >&2\n"
        "echo 'FIRST-REASON-MARK crashed: profile /home/otherproject/.playwriter/browser-profile is locked' >&2\n"
        "echo 'PLAYWRITER_API_KEY=sk-secret-abc123 token=zzz9 see https://user:hunter2@example.com/x?token=qqq' >&2\n"
        "echo 'last-line-mark' >&2\nexit 7\n");
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
            auto expect = [&](bool condition, const std::string& what) {
                if (condition) return;
                result.failures.push_back(what + ": " + cause_of(opened));
            };
            expect(opened.find("last browser start failed: ") != std::string::npos, "the reply of a call whose browser exits on start does not carry the start failure");
            expect(opened.find("exited (7)") != std::string::npos, "the reply does not carry the browser's exit status");
            expect(opened.find("FIRST-REASON-MARK crashed") != std::string::npos && opened.find("last-line-mark") != std::string::npos, "the reply does not carry the browser's last stderr lines");
            expect(opened.find("noise-line-0 ") == std::string::npos && opened.find("noise-line-50 ") == std::string::npos, "the reply carries stderr lines older than the last few");
            for (const char* secret : {"otherproject", "sk-secret-abc123", "hunter2", "zzz9", "qqq"})
                expect(opened.find(secret) == std::string::npos, std::string("the reply carries ") + secret + ", which came from another project's path or a credential in the browser's stderr");
            const std::size_t at = opened.find("last browser start failed: ");
            const std::size_t end = at == std::string::npos ? std::string::npos : opened.find_first_of("\"\n", at);
            if (at != std::string::npos && end != std::string::npos && end - at > 800) result.failures.push_back("the start failure in the reply is " + std::to_string(end - at) + " characters, over the 800 bound");
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
    if (result.failures.empty()) result.summary = "a browser that exits on start leaves its exit status and its last stderr lines in the reply of the failed call, bounded to 800 characters, with other projects' paths, URLs and credentials removed";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_browser_start_reason(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
