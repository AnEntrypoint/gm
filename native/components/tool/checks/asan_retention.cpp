#include "gm/tool.hpp"

#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr int kWarm = 100;
constexpr int kCalls = 400;
constexpr double kLimitBytesPerCall = 64.0;

long long worker_pid(const Session& session) {
    for (const long long pid : session.descendants()) {
        if (proc::process_exe(pid).filename() == "gm-core") return pid;
    }
    return -1;
}

long long live_bytes(const Session& session, long long pid) {
    ::kill(static_cast<pid_t>(pid), SIGUSR2);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    const std::string text = session.stderr_text();
    const std::size_t at = text.rfind("asan-heap live ");
    if (at == std::string::npos) return -1;
    return std::atoll(text.c_str() + at + std::strlen("asan-heap live "));
}

}

CheckResult check_asan_retention(const std::string& binary) {
    CheckResult result;
    const char* enabled = std::getenv("GMNEW_ASAN_PROBE");
    if (enabled == nullptr || std::strcmp(enabled, "1") != 0) {
        result.summary = "skipped: set GMNEW_ASAN_PROBE=1 on an ASan build to read the worker's live heap";
        return result;
    }
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-asan-retention-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    long long first = -1;
    long long second = -1;
    long long third = -1;
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-asan-retention"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            for (int i = 0; i < kWarm; ++i) session.body("return 1;");
            const long long pid = worker_pid(session);
            if (pid < 0) {
                result.failures.push_back("no gm-core worker process was found under the session");
            } else {
                first = live_bytes(session, pid);
                for (int i = 0; i < kCalls; ++i) session.body("return 1;");
                second = live_bytes(session, pid);
                for (int i = 0; i < kCalls; ++i) session.body("return 1;");
                third = live_bytes(session, pid);
                if (first < 0 || second < 0 || third < 0) {
                    result.failures.push_back("the worker did not answer the ASan probe; is this an ASan build?");
                } else {
                    const double per_call = static_cast<double>(third - second) / kCalls;
                    if (per_call > kLimitBytesPerCall) {
                        result.failures.push_back("live heap grows " + std::to_string(per_call) + " bytes per run_code call over the second " + std::to_string(kCalls) +
                                                  " calls (limit " + std::to_string(kLimitBytesPerCall) + "; live " + std::to_string(second) + " then " + std::to_string(third) + " bytes)");
                    }
                    result.summary = "live heap per run_code call over the second " + std::to_string(kCalls) + " calls: " + std::to_string(per_call) + " bytes (live " +
                                     std::to_string(first) + " after warm-up, " + std::to_string(second) + " then " + std::to_string(third) + " bytes)";
                }
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    if (result.summary.empty()) {
        const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
        result.summary = "the probe did not report a live heap (wall " + std::to_string(wall) + " s)";
    }
    return result;
}

}
