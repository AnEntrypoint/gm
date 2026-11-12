#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>
#include <unistd.h>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kSkill = "skill://gm/SKILL.md";

std::vector<json::Value> restart_events(const fs::path& log) {
    std::vector<json::Value> events;
    std::ifstream in(log);
    std::string line;
    while (std::getline(in, line)) {
        if (auto parsed = json::parse(line)) {
            if (text_at(*parsed, "kind") == "restart") events.push_back(*parsed);
        }
    }
    return events;
}

bool flag(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

void connect(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", "restart-skill-read-check"}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
}

}

CheckResult check_restart_skill_read(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-restart-skill-read-" + std::to_string(stamp));
    const fs::path workspace = scratch / "ws";
    const fs::path run_dir = workspace / "run";
    fs::create_directories(workspace);
    std::ofstream(scratch / "quiet-mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const fs::path worker = fs::path(binary).parent_path() / "gm-core";
    std::error_code exists_ec;
    if (!fs::exists(worker, exists_ec)) {
        result.failures.push_back("gm-core is not beside the binary: " + worker.string());
        return result;
    }
    const std::vector<std::string> args{worker.string(), "worker", "--mcp-config", (scratch / "quiet-mcp.json").string(), "--workspace", workspace.string(),
                                        "--run-dir", run_dir.string(), "--supervised", "yes", "--owner", std::to_string(getpid())};
    const std::vector<std::string> through_other_host{"/bin/sh", "-c", "\"$0\" \"$@\"; exit $?", worker.string(), "worker", "--mcp-config", (scratch / "quiet-mcp.json").string(),
                                                      "--workspace", workspace.string(), "--run-dir", run_dir.string(), "--supervised", "yes", "--owner", std::to_string(getpid())};
    const fs::path log = run_dir / "log.jsonl";
    {
        Session first(args, workspace, scratch);
        if (!first.started()) {
            result.failures.push_back("the first worker did not start");
        } else {
            connect(first);
            const json::Value read = first.rpc("resources/read", json::Object{{"uri", kSkill}});
            if (value_at(read, "result.contents") == nullptr) result.failures.push_back("the skill read failed: " + json::dump(read).substr(0, 200));
            tool_json(first, "next_context", json::Object{});
            const json::Value ran = tool_json(first, "run_code", json::Object{{"body", "return 1"}});
            if (!flag(ran, "ok", true)) result.failures.push_back("run_code after the skill read failed: " + json::dump(ran).substr(0, 200));
        }
        first.stop();
    }
    if (result.failures.empty()) {
        Session restarted(args, workspace, scratch);
        if (!restarted.started()) {
            result.failures.push_back("the restarted worker did not start");
        } else {
            connect(restarted);
            const json::Value ran = tool_json(restarted, "run_code", json::Object{{"body", "return 2"}});
            const json::Value* output = value_at(ran, "output");
            if (!flag(ran, "ok", true) || output == nullptr || !output->is_number() || output->as_number() != 2)
                result.failures.push_back("a worker restarted under the same host, with no replayed skill read, did not run run_code: " + json::dump(ran).substr(0, 200));
            const auto restarts = restart_events(log);
            if (restarts.size() != 1 || !flag(restarts[0], "skillRead", true)) result.failures.push_back("the restart event does not carry skillRead true: " + std::to_string(restarts.size()) + " restart event(s)");
        }
        restarted.stop();
    }
    if (result.failures.empty()) {
        Session other(through_other_host, workspace, scratch);
        if (!other.started()) {
            result.failures.push_back("the worker under another host did not start");
        } else {
            connect(other);
            const json::Value refusal = other.rpc("tools/call", json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", "return 3"}}}});
            auto refused_reply = [](const json::Value& rpc) {
                const json::Value* structured = value_at(rpc, "result.structuredContent");
                return structured != nullptr && flag(*structured, "ok", false) && text_at(*structured, "error").find("read skill://gm/SKILL.md") != std::string::npos;
            };
            if (!refused_reply(refusal)) result.failures.push_back("a worker under another host process ran run_code before the skill was read: " + json::dump(refusal).substr(0, 200));
            if (!refused_reply(other.rpc("tools/call", json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", "return 5"}}}})))
                result.failures.push_back("the second run_code under another host process was not refused before the read");
            const auto restarts = restart_events(log);
            if (restarts.size() != 2 || !flag(restarts[1], "skillRead", false)) result.failures.push_back("the second restart event does not carry skillRead false: " + std::to_string(restarts.size()) + " restart event(s)");
            const json::Value read = other.rpc("resources/read", json::Object{{"uri", kSkill}});
            if (value_at(read, "result.contents") == nullptr) result.failures.push_back("the skill read under another host process failed: " + json::dump(read).substr(0, 200));
            const json::Value ran = tool_json(other, "run_code", json::Object{{"body", "return 4"}});
            const json::Value* output = value_at(ran, "output");
            if (!flag(ran, "ok", true) || output == nullptr || !output->is_number() || output->as_number() != 4)
                result.failures.push_back("run_code after the skill read under another host process did not run: " + json::dump(ran).substr(0, 200));
        }
        other.stop();
    }
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a worker restarted under the same host process runs run_code with no replayed skill read and logs restart skillRead true; under another host process every run_code is refused until resources/read on that connection, and then runs (wall" + std::to_string(wall) + " s)";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_restart_skill_read(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
