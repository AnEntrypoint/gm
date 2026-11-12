#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr int kJobSeconds = 65;
constexpr long long kMinWaitMs = 64000;

}

CheckResult check_job_wait(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-job-wait-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    long long waited = -1;
    std::string state;
    {
        Session session(binary, workspace, sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-job-wait"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            const std::string source =
                "const began = Date.now(); await gm.job_start({ job: 'wait', command: 'sleep " + std::to_string(kJobSeconds) + "; echo done', timeoutMs: 120000 }); "
                "const ended = await gm.job_status({ job: 'wait', waitMs: 120000 }); "
                "return { state: ended.state, exitCode: ended.exitCode, waitedMs: Date.now() - began };";
            const json::Value body = tool_json(session, "run_code", json::Object{{"body", source}, {"timeoutMs", 150000}});
            const json::Value* ok = body.find("ok");
            const bool foreground = ok != nullptr && ok->is_bool() && ok->as_bool() && body.find("background") == nullptr;
            const json::Value* output = body.find("output");
            if (!foreground || output == nullptr || !output->is_object()) {
                result.failures.push_back("the wait did not finish in its run_code body: " + json::dump(body).substr(0, 240));
            } else {
                const json::Value* state_value = output->find("state");
                const json::Value* waited_value = output->find("waitedMs");
                if (state_value != nullptr && state_value->is_string()) state = state_value->as_string();
                if (waited_value != nullptr && waited_value->is_number()) waited = static_cast<long long>(waited_value->as_number());
                if (state != "exited") result.failures.push_back("the job_status wait returned state " + state + ", expected exited: " + json::dump(*output).substr(0, 240));
                if (waited < kMinWaitMs) result.failures.push_back("the job_status wait returned after " + std::to_string(waited) + " ms, not past " + std::to_string(kMinWaitMs) + " ms (the old 60 s ceiling)");
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a " + std::to_string(kJobSeconds) + " s job waited on with waitMs 120000 inside one run_code body returned state " + state + " after " + std::to_string(waited) +
                     " ms, not backgrounded (wall " + std::to_string(wall) + " s)";
    return result;
}

}
