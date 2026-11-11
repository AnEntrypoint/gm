#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-job-status-cancel";

json::Value run_body(const std::string& body) {
    return json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", body}}}};
}

}

CheckResult check_job_status_cancel(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-job-status-cancel-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", kCheck}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            const std::string start = tool_text(session, "run_code", json::Object{{"body", "return await gm.job_start({ job: 'jsc-job', command: 'sleep 3; echo done', timeoutMs: 60000 });"}});
            if (start.empty()) result.failures.push_back("job_start did not answer");

            const std::int64_t wait_id = session.send("tools/call", run_body("return await gm.job_status({ job: 'jsc-job', waitMs: 30000 });"));
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            const auto cancelled_at = std::chrono::steady_clock::now();
            session.notify("notifications/cancelled", json::Object{{"requestId", wait_id}, {"reason", "client gave up the job"}});
            std::this_thread::sleep_for(std::chrono::milliseconds(1500));
            if (session.await_reply(wait_id, std::chrono::milliseconds(1))) result.failures.push_back("the cancelled run_code still answered");

            bool named = false;
            bool stopped = false;
            for (const json::Value& event : run_events(workspace / "runs" / "check" / "log.jsonl", "cancel")) {
                const json::Value* id = event.find("requestId");
                if (id == nullptr || !id->is_number() || static_cast<std::int64_t>(id->as_number()) != wait_id) continue;
                named = text_at(event, "by.name") == kCheck && text_at(event, "why") == "client gave up the job";
                stopped = text_at(event, "outcome") == "stopped the call in flight";
            }
            if (!named) result.failures.push_back("the cancel event must name the client and its reason");
            if (!stopped) result.failures.push_back("the cancel event must say what gm did");

            const json::Value status = output_value(tool_json(session, "run_code", json::Object{{"body", "return await gm.job_status({ job: 'jsc-job', waitMs: 20000 });"}}));
            const std::string state = text_at(status, "state");
            const std::string output = text_at(status, "output");
            if (state != "exited") result.failures.push_back("the job did not keep running to its end after the cancel: state " + state);
            if (output.find("done") == std::string::npos) result.failures.push_back("the job output is missing after the cancel: " + json::dump(status).substr(0, 200));
            const double waited = std::chrono::duration<double>(std::chrono::steady_clock::now() - cancelled_at).count();
            result.summary = "a cancelled job_status wait inside run_code got no reply, its cancel named the client, and the job ran on and answered by id " + std::to_string(waited) + " s after the cancel with state " + state;
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary += " (wall " + std::to_string(wall) + " s)";
    return result;
}

}
