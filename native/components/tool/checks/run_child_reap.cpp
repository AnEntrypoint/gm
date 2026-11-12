#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kBody =
    "const started = await gm.run_shell({ command: 'sleep 300 >/dev/null 2>&1 & echo $! > child.pid; echo started', timeoutMs: 10000 });\n"
    "return { started: started.output };\n";

constexpr int kSettleMs = 3000;
constexpr int kPollMs = 50;

long long recorded_pid(const fs::path& file) {
    std::ifstream in(file);
    long long pid = 0;
    in >> pid;
    return pid;
}

}

CheckResult check_run_child_reap(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-run-child-reap-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    long long child = 0;
    long long gone_ms = -1;
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-run-child-reap"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            const json::Value reply = tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 60000}, {"body", kBody}});
            const json::Value out = output_value(reply);
            child = recorded_pid(workspace / "child.pid");
            if (!out.is_object() || child <= 0) {
                result.failures.push_back("the run did not start a child that recorded its pid: " + json::dump(reply).substr(0, 240));
            } else {
                const auto returned = std::chrono::steady_clock::now();
                std::vector<long long> alive = alive_of({child});
                while (!alive.empty() && std::chrono::steady_clock::now() - returned < std::chrono::milliseconds(kSettleMs)) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(kPollMs));
                    alive = alive_of({child});
                }
                gone_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - returned).count();
                if (!alive.empty()) {
                    result.failures.push_back("a child that a run started with run_shell, holding no pipe, is still running " + std::to_string(gone_ms) +
                                              " ms after run_shell returned: pid " + std::to_string(child));
                    kill_processes(alive);
                }
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a child started by run_shell with its output redirected is gone when run_shell returns (pid " + std::to_string(child) + ", polled " +
                     std::to_string(gone_ms) + " ms; wall " + std::to_string(wall) + " s)";
    return result;
}

}
