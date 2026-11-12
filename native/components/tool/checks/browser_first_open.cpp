#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <algorithm>
#include <arpa/inet.h>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <netinet/in.h>
#include <regex>
#include <sstream>
#include <string>
#include <sys/socket.h>
#include <sys/types.h>
#include <thread>
#include <unistd.h>
#include <vector>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

std::string quoted(const std::string& text) {
    std::string out = "\"";
    for (const char c : text) {
        if (c == '\\' || c == '"') out += '\\';
        out += c;
    }
    return out + "\"";
}

std::string exec_body(const std::string& code) {
    return "return JSON.stringify(await gm.playwriter_execute({ code: " + quoted(code) + " }));";
}

std::string open_code(const std::string& url) {
    return "(async () => { const page = await context.newPage(); await page.goto('" + url + "'); state.page = page; return 'WITNESS coi=' + (await page.evaluate(() => crossOriginIsolated)) + ' url=' + page.url(); })()";
}

std::string check_code(const std::string& url) {
    return "(async () => { const page = context.pages().find((p) => p.url() === '" + url + "'); if (!page || page.isClosed()) return 'WITNESS open=false'; return 'WITNESS open=true coi=' + (await page.evaluate(() => crossOriginIsolated)); })()";
}

std::string close_code(const std::string& url) {
    return "(async () => { const page = context.pages().find((p) => p.url() === '" + url + "'); if (page && !page.isClosed()) await page.close(); return 'WITNESS closed=' + (!page || page.isClosed()); })()";
}

std::string page_server_command(int port) {
    return "node -e \"require('http').createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }); s.end('<!doctype html><title>first open</title>'); }).listen(" + std::to_string(port) + ", '127.0.0.1')\" </dev/null >/dev/null 2>&1 & echo $!";
}

std::string outside_browser_command(const std::string& chromium, const fs::path& profile, int port) {
    return "'" + chromium + "' '--user-data-dir=" + profile.string() + "' --remote-debugging-port=" + std::to_string(port) + " --headless=new --no-sandbox --disable-gpu about:blank </dev/null >/dev/null 2>&1 & echo $!";
}

std::string wrapper_script(const fs::path& calls, const std::string& chromium) {
    return "#!/bin/sh\necho \"wrapper $@\" >> '" + calls.string() + "'\nexec '" + chromium + "' --use-angle=swiftshader --enable-unsafe-swiftshader \"$@\"\n";
}

std::string read_text(const fs::path& file) {
    std::ifstream in(file);
    std::stringstream text;
    text << in.rdbuf();
    return text.str();
}

long long first_number(const std::string& text, const std::string& pattern) {
    std::smatch match;
    if (std::regex_search(text, match, std::regex(pattern))) return std::stoll(match[1].str());
    return 0;
}

bool listening(int port) {
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return false;
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<std::uint16_t>(port));
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    const bool up = ::connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof address) == 0;
    ::close(fd);
    return up;
}

bool wait_until(const std::function<bool()>& check, int seconds) {
    for (int tick = 0; tick < seconds * 2; ++tick) {
        if (check()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
    return check();
}

std::string status_of(const fs::path& launcher, const fs::path& home, const fs::path& workspace) {
    return proc::run({"env", "HOME=" + home.string(), "PLAYWRITER_PROJECT_DIR=" + workspace.string(), "PLAYWRITER_TELEMETRY=0", "node", launcher.string(), "status", "--json"}, workspace, {}, 60000).out;
}

void init_session(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}}, {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
}

void write_ports(const fs::path& workspace, int gate, int debug) {
    fs::create_directories(workspace / ".playwriter");
    std::ofstream(workspace / ".playwriter" / "port") << gate << "\n";
    std::ofstream(workspace / ".playwriter" / "debug-port") << debug << "\n";
}

}

CheckResult check_browser_first_open(const std::string& binary) {
    CheckResult result;
    std::vector<std::string>& failures = result.failures;
    std::ostringstream summary;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const int slot = static_cast<int>(stamp % 200);
    const int gate_port = 19000 + slot;
    const int debug_port = 19300 + slot;
    const int page_port = 19600 + slot;
    const int adopt_gate_port = 19900 + slot;
    const int adopt_debug_port = 20200 + slot;
    const auto sandbox = fs::temp_directory_path() / ("gm-first-open-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    const auto adopt_workspace = sandbox / "ws-adopt";
    fs::create_directories(workspace);
    fs::create_directories(adopt_workspace);
    const fs::path host = fs::path(binary).parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
    const fs::path source = build.parent_path().parent_path();
    const fs::path installed = sandbox / ".gmnew" / "current" / "gm";
    const fs::path launcher = sandbox / ".gmnew" / "current" / "pw" / "bin" / "playwriter-project";
    const std::string chromium = fs::exists("/opt/google/chrome/chrome") ? "/opt/google/chrome/chrome" : fs::exists("/usr/lib/chromium/chromium.real") ? "/usr/lib/chromium/chromium.real" : "";
    const std::string page_url = "http://127.0.0.1:" + std::to_string(page_port) + "/";
    std::vector<long long> roots;

    const auto install = proc::run({"env", "HOME=" + sandbox.string(), (host / "gm").string(), "install", "--local", build.string(), "--source", source.string()}, sandbox, {}, 900000);
    if (!install.started || install.exit_code != 0) failures.push_back("the sandbox install failed: " + (install.err.empty() ? install.out : install.err).substr(0, 400));
    if (!fs::exists(launcher)) failures.push_back("the playwriter launcher from the sandbox install is missing: " + launcher.string());

    if (failures.empty()) {
        write_ports(workspace, gate_port, debug_port);
        write_ports(adopt_workspace, adopt_gate_port, adopt_debug_port);
        roots.push_back(first_number(proc::run({"sh", "-c", page_server_command(page_port)}, sandbox, {}, 20000).out, "([0-9]+)"));

        const auto started = proc::run({"env", "HOME=" + sandbox.string(), "PLAYWRITER_PROJECT_DIR=" + workspace.string(), "PLAYWRITER_TELEMETRY=0", "node", launcher.string(), "start"}, workspace, {}, 120000);
        if (!started.started || started.exit_code != 0 || started.err.find("browser ready") == std::string::npos) failures.push_back("start did not report a ready browser: " + started.err.substr(0, 300));
        std::this_thread::sleep_for(std::chrono::seconds(8));
        const bool held = listening(debug_port);
        summary << "start: browser up 8 s after start " << (held ? "true" : "false");
        if (!held) failures.push_back("the browser stopped between start and the first open");
        {
            Session session(installed.string(), workspace, sandbox, 180000, false);
            if (!session.started()) {
                failures.push_back("gm serve did not start from " + installed.string());
            } else {
                init_session(session);
                const std::string opened = session.body(exec_body(open_code(page_url)));
                const bool coi = opened.find("WITNESS coi=true") != std::string::npos;
                summary << "; first open crossOriginIsolated " << (coi ? "true" : "false");
                if (!coi) failures.push_back("the first open did not show a crossOriginIsolated page: " + opened.substr(0, 300));
                std::this_thread::sleep_for(std::chrono::seconds(20));
                const std::string after = session.body(exec_body(check_code(page_url)));
                const bool still = after.find("WITNESS open=true coi=true") != std::string::npos;
                summary << "; still open and crossOriginIsolated after 20 s " << (still ? "true" : "false");
                if (!still) failures.push_back("the page was not open and crossOriginIsolated 20 s after the first open: " + after.substr(0, 300));
                const std::string closed = session.body(exec_body(close_code(page_url)));
                const bool did_close = closed.find("WITNESS closed=true") != std::string::npos;
                summary << "; closed " << (did_close ? "true" : "false");
                if (!did_close) failures.push_back("the page did not close: " + closed.substr(0, 300));
                session.stop();
            }
        }
        const bool released = wait_until([&] { return !listening(debug_port); }, 60);
        summary << "; browser released after the session ended " << (released ? "true" : "false");
        if (!released) failures.push_back("the browser was not released after its page closed and the session ended");

        {
            Session session(installed.string(), workspace, sandbox, 180000, false);
            if (!session.started()) {
                failures.push_back("gm serve did not start for the gate-loss scenario");
            } else {
                init_session(session);
                session.body(exec_body(open_code(page_url)));
                const long long gate_pid = first_number(status_of(launcher, sandbox, workspace), "\"gate\":\\s*\\{\\s*\"pid\":\\s*([0-9]+)");
                if (gate_pid > 0) {
                    ::kill(static_cast<pid_t>(gate_pid), SIGKILL);
                } else {
                    failures.push_back("there was no gate to stop after the first open");
                }
                std::this_thread::sleep_for(std::chrono::seconds(2));
                const std::string after = session.body(exec_body(check_code(page_url)));
                const bool reached = after.find("WITNESS open=true coi=true") != std::string::npos;
                summary << "; gate SIGKILL: next call reached the open page " << (reached ? "true" : "false");
                if (after.find("ECONNREFUSED") != std::string::npos) {
                    failures.push_back("the call after the gate loss reached a stale endpoint: " + after.substr(0, 300));
                } else if (!reached) {
                    failures.push_back("the page was not open after the gate restarted: " + after.substr(0, 300));
                }
                session.body(exec_body(close_code(page_url)));
                session.stop();
            }
        }

        if (chromium.empty()) {
            failures.push_back("no Chromium at /opt/google/chrome/chrome or /usr/lib/chromium/chromium.real");
        } else {
            const fs::path profile = adopt_workspace / ".playwriter" / "browser-profile";
            fs::create_directories(profile);
            const fs::path wrapper_dir = sandbox / "wrapper";
            fs::create_directories(wrapper_dir);
            const fs::path calls = wrapper_dir / "calls.txt";
            const fs::path wrapper = wrapper_dir / "swiftshader-wrapper.sh";
            std::ofstream(wrapper) << wrapper_script(calls, chromium);
            fs::permissions(wrapper, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec);
            const long long outside_pid = first_number(proc::run({"sh", "-c", outside_browser_command(chromium, profile, adopt_debug_port)}, adopt_workspace, {}, 20000).out, "([0-9]+)");
            roots.push_back(outside_pid);
            if (!wait_until([&] { return listening(adopt_debug_port); }, 30)) failures.push_back("the browser started outside the launcher did not open its debug port");
            const auto adopted = proc::run({"env", "HOME=" + sandbox.string(), "PLAYWRITER_PROJECT_DIR=" + adopt_workspace.string(), "PLAYWRITER_TELEMETRY=0", "PLAYWRITER_BROWSER_PATH=" + wrapper.string(), "node", launcher.string(), "start"}, adopt_workspace, {}, 180000);
            if (!adopted.started || adopted.exit_code != 0) failures.push_back("start with PLAYWRITER_BROWSER_PATH failed: " + adopted.err.substr(0, 300));
            const std::string calls_text = read_text(calls);
            const long long browser_pid = first_number(status_of(launcher, sandbox, adopt_workspace), "\"browser\":\\s*\\{\\s*\"pid\":\\s*([0-9]+)");
            roots.push_back(browser_pid);
            std::string cmdline = browser_pid > 0 ? read_text("/proc/" + std::to_string(browser_pid) + "/cmdline") : std::string();
            std::replace(cmdline.begin(), cmdline.end(), '\0', ' ');
            const bool wrapper_called = calls_text.find("wrapper") != std::string::npos;
            const bool swiftshader = cmdline.find("--use-angle=swiftshader") != std::string::npos;
            summary << "; outside browser pid " << outside_pid << " became project browser pid " << browser_pid << ", wrapper called " << (wrapper_called ? "true" : "false") << ", SwiftShader flags " << (swiftshader ? "true" : "false");
            if (!wrapper_called) failures.push_back("PLAYWRITER_BROWSER_PATH was not used: the browser started outside the launcher was adopted");
            if (browser_pid <= 0 || browser_pid == outside_pid) failures.push_back("the browser started outside the launcher stayed the project browser");
            if (!swiftshader) failures.push_back("the project browser was not started with the configured wrapper flags");
        }
    }

    for (const long long pid : processes_mentioning(sandbox.string())) roots.push_back(pid);
    std::vector<long long> live;
    for (const long long pid : roots) {
        if (pid > 0) live.push_back(pid);
    }
    const auto tree = process_tree(live);
    kill_processes(tree);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    const auto survivors = alive_of(tree);
    if (!survivors.empty()) {
        std::string ids;
        for (const long long pid : survivors) ids += (ids.empty() ? "" : " ") + std::to_string(pid);
        failures.push_back(std::to_string(survivors.size()) + " process(es) started by this check are still alive: " + ids);
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    result.summary = summary.str();
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_browser_first_open(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
