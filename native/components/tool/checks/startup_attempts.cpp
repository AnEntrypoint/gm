#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kConfig = R"({"mcpServers":{"playwriter":{"disabled":true},"crashy":{"command":"sh","args":["-c","echo boom-from-crashy >&2; exit 128"],"startupTimeoutMs":20000},"silent":{"command":"sh","args":["-c","sleep 30"],"startupTimeoutMs":2000}}})";

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

}

CheckResult check_startup_attempts(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-startup-native-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace / ".gm");
    {
        std::ofstream(workspace / ".gm" / "mcp.json") << kConfig;
        Session session(binary, workspace, sandbox, 180000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "startup-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{{"task", "startup attempts check"}, {"owner", true}});
            const json::Value ran = tool_json(session, "run_code", json::Object{{"body", "return await gm.query_log({ kind: \"mcp-server\" });"}});
            const std::vector<json::Value> events = events_of(ran);
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
            if (!failed_with(events, "silent", "MCP server silent did not start after 1 attempt(s): initialize timed out after 2000 ms")) result.failures.push_back("native: silent is not retried after a timeout");
            if (!failed_containing(events, "silent", "Startup budget 2000 ms (startupTimeoutMs)")) result.failures.push_back("native: silent names its startup budget");
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a server that exits before it answers is retried and each attempt's exit code is named, and a timed-out server names its startup budget (wall " + std::to_string(wall) + " s)";
    return result;
}

}
