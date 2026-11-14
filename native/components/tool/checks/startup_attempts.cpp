#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kConfig = R"({"mcpServers":{"playwriter":{"disabled":true},"crashy":{"command":"sh","args":["-c","echo boom-from-crashy >&2; exit 128"],"startupTimeoutMs":20000},"silent":{"command":"sh","args":["-c","sleep 30"],"startupTimeoutMs":6000}}})";

constexpr const char* kDisabledConfig = R"({"mcpServers":{"playwriter":{"disabled":true},"crashy":{"disabled":true},"silent":{"disabled":true}}})";
constexpr const char* kSlowConfig = R"({"mcpServers":{"playwriter":{"disabled":true},"crashy":{"disabled":true},"silent":{"command":"sh","args":["-c","sleep 30"],"startupTimeoutMs":6000}}})";
constexpr auto kReplySlack = std::chrono::milliseconds(2500);
constexpr auto kEventDeadline = std::chrono::seconds(15);

long long elapsed_ms(const std::chrono::steady_clock::time_point& started) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
}

long long resource_reply_ms(const std::string& binary, const fs::path& sandbox, const std::string& name, const std::string& config) {
    const fs::path workspace = sandbox / (name + "-ws");
    const fs::path home = sandbox / (name + "-home");
    fs::create_directories(workspace / ".gm");
    fs::create_directories(home);
    std::ofstream(home / "quiet.json") << config;
    std::ofstream(workspace / ".gm" / "mcp.json") << config;
    Session session(binary, workspace, home, 180000, true);
    if (!session.started()) return -1;
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", name}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    const auto started = std::chrono::steady_clock::now();
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    const long long ms = elapsed_ms(started);
    session.stop();
    return ms;
}

std::vector<json::Value> events_of(const json::Value& run) {
    const json::Value output = output_value(run);
    const json::Value* found = value_at(output, "output");
    json::Value list = found != nullptr ? *found : output;
    if (list.is_string()) {
        if (auto parsed = json::parse(list.as_string())) list = *parsed;
    }
    if (list.is_array()) return list.as_array();
    return {};
}

bool contains(const std::string& text, const std::string& needle) {
    return text.find(needle) != std::string::npos;
}

std::string error_of(const json::Value& event) {
    return text_at(event, "error");
}

bool failed_with(const std::vector<json::Value>& events, const std::string& server, const std::string& prefix) {
    for (const json::Value& event : events) {
        if (text_at(event, "server") == server && text_at(event, "state") == "failed" && error_of(event).rfind(prefix, 0) == 0) return true;
    }
    return false;
}

bool failed_containing(const std::vector<json::Value>& events, const std::string& server, const std::string& text) {
    for (const json::Value& event : events) {
        if (text_at(event, "server") == server && text_at(event, "state") == "failed" && contains(error_of(event), text)) return true;
    }
    return false;
}

bool failures_ready(const std::vector<json::Value>& events) {
    return failed_with(events, "crashy", "MCP server crashy did not start after 3 attempt(s)") &&
           failed_with(events, "silent", "MCP server silent did not start after 1 attempt(s): initialize timed out after 6000 ms");
}

}

CheckResult check_startup_attempts(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-startup-native-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    long long resource_ms = -1;
    long long context_ms = -1;
    long long body_ms = -1;
    fs::create_directories(workspace / ".gm");
    const long long baseline_ms = resource_reply_ms(binary, sandbox, "baseline", kDisabledConfig);
    const long long slow_ms = resource_reply_ms(binary, sandbox, "slow", kSlowConfig);
    const long long budget_ms = baseline_ms >= 0 ? baseline_ms + kReplySlack.count() : -1;
    if (budget_ms < 0) result.failures.push_back("the no-downstream baseline session did not answer resources/read");
    if (slow_ms > budget_ms) result.failures.push_back("an injected downstream startup wait slowed gm's own reply: " + std::to_string(slow_ms) + " ms with a " + std::to_string(budget_ms) + " ms budget");
    {
        std::ofstream(workspace / ".gm" / "mcp.json") << kConfig;
        Session session(binary, workspace, sandbox, 180000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "startup-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            const auto resource_started = std::chrono::steady_clock::now();
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            resource_ms = elapsed_ms(resource_started);
            const auto context_started = std::chrono::steady_clock::now();
            tool_text(session, "next_context", json::Object{{"task", "startup attempts check"}, {"owner", true}});
            context_ms = elapsed_ms(context_started);
            const auto body_started = std::chrono::steady_clock::now();
            const json::Value ran = tool_json(session, "run_code", json::Object{{"body", "return await gm.query_log({ kind: \"mcp-server\" });"}});
            body_ms = elapsed_ms(body_started);
            if (resource_ms > budget_ms) result.failures.push_back("resources/read waited " + std::to_string(resource_ms) + " ms for a downstream server, budget " + std::to_string(budget_ms) + " ms");
            if (context_ms > budget_ms) result.failures.push_back("next_context waited " + std::to_string(context_ms) + " ms for a downstream server, budget " + std::to_string(budget_ms) + " ms");
            if (body_ms > budget_ms) result.failures.push_back("run_code waited " + std::to_string(body_ms) + " ms for a downstream server, budget " + std::to_string(budget_ms) + " ms");
            std::vector<json::Value> events = events_of(ran);
            const fs::path log = workspace / "runs" / "check" / "log.jsonl";
            const auto deadline = std::chrono::steady_clock::now() + kEventDeadline;
            while (!failures_ready(events) && std::chrono::steady_clock::now() < deadline) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                events = run_events(log, "mcp-server");
            }
            if (events.empty()) result.failures.push_back("native: no mcp-server events were logged: " + json::dump(ran).substr(0, 300));

            std::size_t crashy_retrying = 0;
            std::size_t crashy_exit = 0;
            for (const json::Value& event : events) {
                if (text_at(event, "server") != "crashy") continue;
                if (text_at(event, "state") == "retrying") ++crashy_retrying;
                if (text_at(event, "reason") == "exited with code 128" || contains(error_of(event), "exited with code 128")) ++crashy_exit;
            }
            if (crashy_retrying != 2) result.failures.push_back("native: crashy retried twice: saw " + std::to_string(crashy_retrying) + " retrying events");
            if (crashy_exit < 3) result.failures.push_back("native: exit code 128 in each attempt: saw " + std::to_string(crashy_exit));
            if (!failed_with(events, "crashy", "MCP server crashy did not start after 3 attempt(s)")) result.failures.push_back("native: crashy failed after 3 attempts");
            if (!failed_containing(events, "crashy", "stderr: boom-from-crashy")) result.failures.push_back("native: crashy names its stderr tail");
            if (!failed_containing(events, "crashy", "Startup budget 20000 ms (startupTimeoutMs)")) result.failures.push_back("native: crashy names its startup budget");
            if (!failed_with(events, "silent", "MCP server silent did not start after 1 attempt(s): initialize timed out after 6000 ms")) result.failures.push_back("native: silent is not retried after a timeout");
            if (!failed_containing(events, "silent", "Startup budget 6000 ms (startupTimeoutMs)")) result.failures.push_back("native: silent names its startup budget");
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a server that exits before it answers is retried and each attempt's exit code is named, and a timed-out server names its startup budget; a no-downstream baseline answered resources/read in " + std::to_string(baseline_ms) + " ms, the budget is baseline plus " + std::to_string(kReplySlack.count()) + " ms, an injected startup wait took " + std::to_string(slow_ms) + " ms, and gm's own tools answered while downstream servers were starting: resources/read " + std::to_string(resource_ms) + " ms, next_context " + std::to_string(context_ms) + " ms, run_code " + std::to_string(body_ms) + " ms (wall " + std::to_string(wall) + " s)";
    return result;
}

}
