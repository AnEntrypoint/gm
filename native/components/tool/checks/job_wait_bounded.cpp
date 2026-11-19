#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-job-wait-bounded";

}

CheckResult check_job_wait_bounded(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-job-wait-bounded-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        Session session(binary, workspace, sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", kCheck}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            const std::string start = tool_text(session, "run_code", json::Object{{"body", "return await gm.job_start({ job: 'jbw-job', command: 'sleep 110; echo done', timeoutMs: 200000 });"}});
            if (start.empty()) result.failures.push_back("job_start did not answer");

            const auto waited_at = std::chrono::steady_clock::now();
            const json::Value waiting = output_value(tool_json(session, "run_code", json::Object{{"body", "return await gm.job_status({ job: 'jbw-job', waitMs: 600000 });"}}));
            const double waited = std::chrono::duration<double>(std::chrono::steady_clock::now() - waited_at).count();
            const std::string state = text_at(waiting, "state");
            if (state != "running") result.failures.push_back("a job_status wait longer than the foreground cap did not answer inside its body with state running: " + json::dump(waiting).substr(0, 240));
            if (text_at(waiting, "hint").find("job_status again") == std::string::npos) result.failures.push_back("the running reply does not say to call job_status again: " + json::dump(waiting).substr(0, 240));

            tool_text(session, "run_code", json::Object{{"body", "return await gm.job_stop({ job: 'jbw-job' });"}});
            result.summary = "a job_status wait of 600000 ms inside run_code answered state " + state + " with a hint after " + std::to_string(waited) + " s, inside its own body";
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    if (result.failures.empty()) result.summary += " (wall " + std::to_string(wall) + " s)";
    return result;
}

}
