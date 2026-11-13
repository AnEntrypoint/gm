#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

}

CheckResult check_witness_windows_cmd([[maybe_unused]] const std::string& binary) {
    CheckResult result;
#if !defined(_WIN32)
    result.summary = "skipped: the cmd-only run_shell witness drives cmd.exe and runs on Windows only";
    return result;
#else
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-windows-cmd-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const std::string control = "echo gm-windows-cmd-witness-ok";
    const std::string cmd_only = "dir /b";
    {
        Session session(binary, workspace, sandbox, 180000, true, {"--build-dir", "none"});
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-windows-cmd-witness"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_json(session, "next_context", json::Object{});
            const json::Value control_reply = tool_json(session, "run_code", json::Object{{"format", "esm"}, {"body", "return await gm.run_shell({ command: \"" + control + "\" });"}});
            const json::Value cmd_reply = tool_json(session, "run_code", json::Object{{"format", "esm"}, {"body", "return await gm.run_shell({ command: \"" + cmd_only + "\" });"}});
            const json::Value cmd_value = output_value(cmd_reply);
            const json::Value control_value = output_value(control_reply);
            if (text_at(cmd_value, "launcher") != "cmd" || !(value_at(cmd_value, "ok") != nullptr && value_at(cmd_value, "ok")->is_bool() && value_at(cmd_value, "ok")->as_bool()))
                result.failures.push_back("cmd-only run_shell did not use cmd.exe: " + json::dump(cmd_value).substr(0, 300));
            result.summary = "cmd-only run_shell ran under cmd.exe (control " + json::dump(control_value).substr(0, 120) + ")";
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    if (result.failures.empty()) result.summary += " (wall " + std::to_string(wall) + " s)";
    return result;
#endif
}

}
