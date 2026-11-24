#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-job-wait-batch";
constexpr double kSerialLimitMs = 5000;
constexpr const char* kJobs[] = {"jwb-1", "jwb-2", "jwb-3"};

}

CheckResult check_job_wait_batch(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-job-wait-batch-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            tool_text(session, "run_code", json::Object{{"body", R"js(for (const job of ['jwb-1', 'jwb-2', 'jwb-3']) await gm.job_start({ job, command: 'sleep 2; echo ' + job, timeoutMs: 60000 }); return 'started';)js"}});
            const json::Value batch = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const began = Date.now(); const ended = await Promise.all(['jwb-1', 'jwb-2', 'jwb-3'].map((job) => gm.job_status({ job, waitMs: 30000 }))); return { elapsed: Date.now() - began, states: ended.map((r) => r.state), outputs: ended.map((r) => r.output) };)js"}}));

            const double elapsed = number_at(batch, "elapsed");
            if (elapsed <= 0 || elapsed >= kSerialLimitMs)
                result.failures.push_back("three 2 s jobs awaited in one run_code body returned after " + std::to_string(elapsed) + " ms; concurrent waits return near 2 s, serial ones near 6 s");

            const json::Value* states = value_at(batch, "states");
            if (states == nullptr || !states->is_array() || states->as_array().size() != 3) {
                result.failures.push_back("the batch did not return three states: " + json::dump(batch).substr(0, 200));
            } else {
                for (const json::Value& state : states->as_array()) {
                    if (!state.is_string() || state.as_string() != "exited") {
                        result.failures.push_back("a job was not exited when the batch returned: " + json::dump(state));
                        break;
                    }
                }
            }

            const json::Value* outputs = value_at(batch, "outputs");
            for (const char* job : kJobs) {
                bool found = false;
                if (outputs != nullptr && outputs->is_array()) {
                    for (const json::Value& output : outputs->as_array()) {
                        if (output.is_string() && output.as_string().find(job) != std::string::npos) found = true;
                    }
                }
                if (!found) result.failures.push_back(std::string("the batch returned no output for ") + job);
            }
            result.summary = "three 2 s shell jobs awaited by one run_code body (one tool call) returned in " + std::to_string(elapsed) + " ms, each state exited and each with its own output";
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
