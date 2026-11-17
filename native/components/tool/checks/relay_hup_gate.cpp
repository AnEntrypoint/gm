#include "gm/tool.hpp"

#if !defined(_WIN32)

#include <chrono>
#include <csignal>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <regex>
#include <signal.h>
#include <sys/types.h>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

bool is_zombie(long long pid) {
#if defined(__linux__)
    std::ifstream stat("/proc/" + std::to_string(pid) + "/stat");
    const std::string text((std::istreambuf_iterator<char>(stat)), std::istreambuf_iterator<char>());
    const std::size_t close = text.rfind(')');
    return close != std::string::npos && close + 2 < text.size() && text[close + 2] == 'Z';
#else
    const proc::Outcome state = proc::run({"ps", "-o", "stat=", "-p", std::to_string(pid)}, {}, {}, 5000);
    return state.out.find('Z') != std::string::npos;
#endif
}

bool has_exited(long long pid) {
    return proc::start_time_of(pid) == 0 || is_zombie(pid);
}

std::string read_text(const fs::path& file) {
    std::ifstream in(file);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

bool exits_within(long long pid, std::chrono::seconds limit) {
    const auto began = std::chrono::steady_clock::now();
    while (!has_exited(pid) && std::chrono::steady_clock::now() - began < limit) std::this_thread::sleep_for(std::chrono::milliseconds(100));
    return has_exited(pid);
}

}

CheckResult check_relay_hup_gate(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = fs::temp_directory_path() / ("gm-relay-hup-gate-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    fs::create_directories(workspace);
    const fs::path host = fs::path(binary).parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
    const fs::path source = build.parent_path().parent_path();
    const fs::path installed = sandbox / ".gmnew" / "current" / "gm";
    const auto install = proc::run({"env", "HOME=" + sandbox.string(), (host / "gm").string(), "install", "--local", build.string(), "--source", source.string()}, sandbox, {}, 900000);
    if (!install.started || install.exit_code != 0) result.failures.push_back("the sandbox install failed: " + (install.err.empty() ? install.out : install.err).substr(0, 400));
    long long gate = 0;
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
            const std::string first = session.body("return JSON.stringify(await gm.playwriter_execute({ code: 'return 1;' }));");
            const std::regex launched("gate pid ([0-9]+)");
            std::smatch found;
            if (std::regex_search(first, found, launched)) {
                gate = std::stoll(found[1].str());
            } else {
                result.failures.push_back("the first browser call reported no gate pid: " + first.substr(0, 300));
            }
            const long long relay = session.pid();
            if (gate > 0) {
                const fs::path gate_log = workspace / ".playwriter" / "gate.log";
                const std::string log_before = read_text(gate_log);
                if (::kill(static_cast<pid_t>(relay), SIGHUP) != 0) result.failures.push_back("could not send SIGHUP to the relay " + std::to_string(relay));
                if (!exits_within(relay, std::chrono::seconds(20))) result.failures.push_back("the relay " + std::to_string(relay) + " did not exit within 20 s of SIGHUP");
                const bool gate_gone = exits_within(gate, std::chrono::seconds(30));
                if (!gate_gone) result.failures.push_back("the gate " + std::to_string(gate) + " outlived its relay's SIGHUP by 30 s");
                const std::string log_after = read_text(gate_log);
                const std::string since = log_after.size() >= log_before.size() ? log_after.substr(log_before.size()) : log_after;
                if (since.find("last lease released") == std::string::npos)
                    result.failures.push_back("the gate did not log its last lease released after SIGHUP; gate.log since SIGHUP: " + since.substr(0, 400));
            }
            result.summary = "SIGHUP to a serve relay that owns a playwriter gate: the relay exits, and the gate it started exits with it (no gate process left on its port)";
            session.stop();
        }
    }
    if (gate > 0 && !has_exited(gate)) kill_processes({gate});
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_relay_hup_gate(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
