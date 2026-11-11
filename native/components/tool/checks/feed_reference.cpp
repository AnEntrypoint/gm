#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

std::string mark(int n) {
    return "MARK" + std::to_string(n) + "-" + std::string(9000, 'x');
}

}

CheckResult check_feed_reference(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-feed-reference-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::size_t measured = 0;
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-feed-reference"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            for (int n = 1; n <= 3; ++n) session.body("return " + json::quote(mark(n)) + ";");
            session.body("return await gm.job_start({ job: 'feed-job', command: 'sleep 30', timeoutMs: 60000 });");
            session.body("return await gm.job_stop({ job: 'feed-job' });");
            const std::string reply = tool_text(session, "next_context", json::Object{});
            measured = reply.size();
            const std::size_t tokens = measured / 4;
            for (int n = 1; n <= 3; ++n) {
                if (reply.find("MARK" + std::to_string(n) + "-") != std::string::npos) {
                    result.failures.push_back("the next_context reply replays the earlier run_code outputs; they must be sent as references");
                    break;
                }
            }
            if (reply.find("feed-job") == std::string::npos) result.failures.push_back("the pending job event must still reach the reply in full: " + reply.substr(0, 300));
            if (measured >= 8000) result.failures.push_back("the next_context reply after a pending event is " + std::to_string(measured) + " characters (about " + std::to_string(tokens) + " tokens), expected under 8000");
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "next_context after a pending job event: " + std::to_string(measured) + " characters; the earlier run_code bodies and outputs are references and the job event is in full (wall " + std::to_string(wall) + " s)";
    return result;
}

}
