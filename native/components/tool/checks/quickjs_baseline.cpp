#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

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
        std::error_code ec;
        const auto exe = std::filesystem::read_symlink("/proc/" + std::to_string(pid) + "/exe", ec);
        if (!ec && exe.filename() == "gm-core") return pid;
    }
    return -1;
}

long long resident_kb(long long pid) {
    if (pid < 0) return -1;
    std::ifstream in("/proc/" + std::to_string(pid) + "/status");
    std::string line;
    while (std::getline(in, line)) {
        if (line.rfind("VmRSS:", 0) == 0) return std::stoll(line.substr(6));
    }
    return -1;
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
        Session session(binary, workspace, sandbox);
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
            for (int call = 2; call <= kCalls; ++call) {
                const std::string text = session.body(body);
                if (last_line(text) != "1") result.failures.push_back("run_code call " + std::to_string(call) + " did not return 1: " + text.substr(0, 200));
                if (call == 10) after_ten_kb = resident_kb(pid);
            }
            const long long after_all_kb = resident_kb(pid);
            if (last_line(first) != "1") result.failures.push_back("the first run_code did not return 1: " + first.substr(0, 200));
            if (pid < 0) result.failures.push_back("no gm-core worker process was found under the session");
            const double per_call_kb = after_ten_kb > 0 && after_all_kb > 0 ? static_cast<double>(after_all_kb - after_ten_kb) / (kCalls - 10) : -1;
            std::ostringstream out;
            out << "start " << start_ms << " ms to the first reply; first run_code " << first_ms << " ms; worker resident memory at rest " << rest_kb
                << " kB, after 1 run_code " << after_one_kb << " kB, after 10 " << after_ten_kb << " kB, after " << kCalls << " " << after_all_kb
                << " kB; growth per run_code " << per_call_kb << " kB over calls 11 to " << kCalls;
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
