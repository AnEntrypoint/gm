#include "gm/tool.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

constexpr std::uint64_t kWatchdogMs = 600000;

std::chrono::steady_clock::time_point now() { return std::chrono::steady_clock::now(); }

double ms_between(std::chrono::steady_clock::time_point from, std::chrono::steady_clock::time_point to) {
    return std::chrono::duration<double, std::milli>(to - from).count();
}

std::string last_line(const std::string& text) {
    const std::size_t newline = text.rfind('\n');
    return newline == std::string::npos ? text : text.substr(newline + 1);
}

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

CheckResult check_quickjs_baseline(const std::string& binary) {
    CheckResult result;
#if defined(__linux__)
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-quickjs-baseline-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    std::filesystem::create_directories(workspace);
    constexpr int kCalls = 40;
    const std::string body = "return 1;";
    std::string summary;
    {
        const auto started = now();
        Session session(binary, workspace, sandbox, kWatchdogMs);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            const double start_ms = ms_between(started, now());
            const long long pid = worker_pid(session);
            const long long rest_kb = resident_kb(pid);

            const auto first_at = now();
            const std::string first = session.body(body);
            const double first_ms = ms_between(first_at, now());
            const long long after_one_kb = resident_kb(pid);

            long long after_ten_kb = -1;
            bool reported_silence = false;
            const auto loop_at = now();
            for (int call = 2; call <= kCalls; ++call) {
                const std::string text = session.body(body);
                if (last_line(text) != "1") result.failures.push_back("run_code call " + std::to_string(call) + " did not return 1: " + text.substr(0, 200));
                if (last_line(text) != "1" && !reported_silence) {
                    reported_silence = true;
                    const std::string stderr_text = session.stderr_text();
                    result.failures.push_back("the worker gave no reply to run_code call " + std::to_string(call) + " (session watchdog expired: " +
                                              (session.expired() ? "yes" : "no") + "); its stderr ends: " +
                                              (stderr_text.size() > 2000 ? stderr_text.substr(stderr_text.size() - 2000) : stderr_text));
                }
                if (call == 10) after_ten_kb = resident_kb(pid);
            }
            const double loop_mean_ms = ms_between(loop_at, now()) / (kCalls - 1);
            if (const char* budget = std::getenv("GM_BASELINE_MAX_MEAN_MS"); budget != nullptr && loop_mean_ms > std::atof(budget))
                result.failures.push_back("back-to-back mean " + std::to_string(loop_mean_ms) + " ms per run_code is over the budget of " + budget + " ms");
            const long long after_all_kb = resident_kb(pid);
            double spaced_ms = -1;
            for (int sample = 0; sample < 3; ++sample) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1000));
                const auto spaced_at = now();
                const std::string spaced = session.body(body);
                const double took = ms_between(spaced_at, now());
                if (last_line(spaced) != "1") result.failures.push_back("a run_code 1 s after the previous reply did not return 1: " + spaced.substr(0, 200));
                if (spaced_ms < 0 || took < spaced_ms) spaced_ms = took;
            }
            session.body("globalThis.gmLeak = 1; return 1;");
            const std::string isolated = session.body("return typeof globalThis.gmLeak === 'undefined' ? 1 : 0;");
            if (last_line(isolated) != "1") result.failures.push_back("a global set by one run_code body was visible in the next: " + isolated.substr(0, 200));
            if (last_line(first) != "1") result.failures.push_back("the first run_code did not return 1: " + first.substr(0, 200));
            if (pid < 0) result.failures.push_back("no gm-core worker process was found under the session");
            const double per_call_kb = after_ten_kb > 0 && after_all_kb > 0 ? static_cast<double>(after_all_kb - after_ten_kb) / (kCalls - 10) : -1;
            std::ostringstream out;
            out << "start " << start_ms << " ms to the first reply; first run_code " << first_ms << " ms; worker resident memory at rest " << rest_kb
                << " kB, after 1 run_code " << after_one_kb << " kB, after 10 " << after_ten_kb << " kB, after " << kCalls << " " << after_all_kb
                << " kB; growth per run_code " << per_call_kb << " kB over calls 11 to " << kCalls << "; back-to-back mean " << loop_mean_ms
                << " ms per run_code over calls 2 to " << kCalls << "; fastest of 3 run_code calls sent 1 s after the previous reply " << spaced_ms
                << " ms; a global set by one body is absent in the next";
            summary = out.str();
        }
        session.stop();
    }
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = summary;
#else
    result.summary = "not measured: the resident memory witness reads /proc, which this platform does not have";
#endif
    return result;
}

}
