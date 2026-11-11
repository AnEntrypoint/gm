#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr int kWarm = 100;
constexpr int kCalls = 400;
constexpr long long kLimitKb = 2048;

long long worker_pid(const Session& session) {
    for (const long long pid : session.descendants()) {
        if (proc::process_exe(pid).filename() == "gm-core") return pid;
    }
    return -1;
}

long long resident_kb(long long pid) {
    return proc::resident_kb(pid);
}

}

CheckResult check_worker_growth(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-worker-growth-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    long long growth = -1;
    long long before = -1;
    long long after = -1;
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-worker-growth"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            for (int i = 0; i < kWarm; ++i) session.body("return 1;");
            const long long pid = worker_pid(session);
            if (pid < 0) {
                result.failures.push_back("no gm-core worker process was found under the session");
            } else {
                before = resident_kb(pid);
                for (int i = 0; i < kCalls; ++i) session.body("return 1;");
                after = resident_kb(pid);
                growth = after - before;
                if (growth > kLimitKb) {
                    result.failures.push_back("the worker grew " + std::to_string(growth) + " KB over " + std::to_string(kCalls) + " run_code calls (limit " + std::to_string(kLimitKb) +
                                              " KB; " + std::to_string(before) + " KB then " + std::to_string(after) + " KB)");
                }
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "the worker's resident memory held within " + std::to_string(kLimitKb) + " KB over " + std::to_string(kCalls) + " run_code calls after " + std::to_string(kWarm) +
                     " warm calls (growth " + std::to_string(growth) + " KB; wall " + std::to_string(wall) + " s)";
    return result;
}

}
