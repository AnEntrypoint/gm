#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kRepeated = "echo gm-repeated-check";
constexpr const char* kOnce = "echo gm-single-check";
constexpr const char* kJob = "echo gm-job-check";

const json::Value* row_for(const json::Value& checks, const std::string& command) {
    if (!checks.is_array()) return nullptr;
    for (const json::Value& row : checks.as_array()) {
        if (text_at(row, "command") == command) return &row;
    }
    return nullptr;
}

bool count_is(const json::Value* row, double expected) {
    const json::Value* count = row != nullptr ? value_at(*row, "count") : nullptr;
    return count != nullptr && count->is_number() && count->as_number() == expected;
}

bool flag_true(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool();
}

bool timed(const json::Value* row) {
    if (row == nullptr) return false;
    const json::Value* total = value_at(*row, "totalMs");
    const json::Value* last = value_at(*row, "lastMs");
    return total != nullptr && total->is_number() && last != nullptr && last->is_number();
}

}

CheckResult check_repeated_checks(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-repeated-checks-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        std::ofstream(workspace / "README.md") << "x\n";
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "repeated-checks-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});

            const std::string ran_body = "for (let i = 0; i < 3; i += 1) await gm.run_shell({ command: " + json::quote(kRepeated) + " }); await gm.run_shell({ command: " + json::quote(kOnce) + " }); return 'ran';";
            const json::Value ran_reply = tool_json(session, "run_code", json::Object{{"body", ran_body}});
            if (!flag_true(ran_reply, "ok")) result.failures.push_back("run_code did not run: " + json::dump(ran_reply).substr(0, 300));
            const std::string job_body = "for (const job of ['gm-job-a', 'gm-job-b']) await gm.job_start({ job, command: " + json::quote(kJob) + ", timeoutMs: 20000 }); for (const job of ['gm-job-a', 'gm-job-b']) await gm.job_status({ job, waitMs: 20000 }); return 'jobs';";
            const json::Value jobs_reply = tool_json(session, "run_code", json::Object{{"body", job_body}});
            if (!flag_true(jobs_reply, "ok")) result.failures.push_back("the jobs run did not run: " + json::dump(jobs_reply).substr(0, 300));

            const json::Value reply = tool_json(session, "next_context", json::Object{{"full", true}});
            const json::Value* checks = value_at(reply, "checks");
            const json::Value empty;
            const json::Value& rows = checks != nullptr ? *checks : empty;
            if (json::dump(reply).find("\"kind\":\"check\"") != std::string::npos) result.failures.push_back("a check event is in the raw feed of next_context");
            const json::Value* repeated = row_for(rows, kRepeated);
            if (repeated == nullptr) result.failures.push_back("next_context does not list the repeated command: " + json::dump(rows).substr(0, 400));
            if (!count_is(repeated, 3)) result.failures.push_back("the repeated command's count is not 3: " + (repeated != nullptr ? json::dump(*repeated).substr(0, 200) : std::string("missing")));
            if (!timed(repeated)) result.failures.push_back("the repeated command has no wall time");
            const json::Value* job = row_for(rows, kJob);
            if (!count_is(job, 2)) result.failures.push_back("the job command's count is not 2 after two job ends: " + (job != nullptr ? json::dump(*job).substr(0, 200) : std::string("missing")));
            if (!timed(job)) result.failures.push_back("the job command has no wall time");
            if (row_for(rows, kOnce) != nullptr) result.failures.push_back("a command run once is listed as repeated: " + json::dump(rows).substr(0, 400));
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "next_context lists a run_shell command run three times and a job command ended twice, each with its count and wall time, and leaves out a command run once (wall " + std::to_string(wall) + " s)";
    return result;
}

}
