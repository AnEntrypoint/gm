#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

json::Value initialize_as(Session& session, const std::string& version) {
    return session.rpc("initialize", json::Object{{"protocolVersion", version}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-protocol-flag"}, {"version", "1"}}}});
}

bool discover_lists(Session& session, const std::string& version) {
    const json::Value reply = session.rpc("server/discover", json::Object{});
    const json::Value* listed = value_at(reply, "result.supportedVersions");
    if (listed == nullptr || !listed->is_array()) return false;
    const auto& versions = listed->as_array();
    return std::any_of(versions.begin(), versions.end(), [&](const json::Value& v) { return v.is_string() && v.as_string() == version; });
}

}

CheckResult check_protocol_flag(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-protocol-flag-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace / ".gm");
    std::ofstream(workspace / ".gm" / "mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const std::string gm = fs::absolute(binary).string();
    {
        Session session({gm, "serve", "--run-dir", (sandbox / "off").string()}, workspace, sandbox, 180000);
        if (!session.started()) {
            result.failures.push_back("the default serve did not start");
        } else {
            const std::string answered = text_at(initialize_as(session, "2026-07-28"), "result.protocolVersion");
            if (answered != "2025-11-25") result.failures.push_back("with the flag off, initialize 2026-07-28 answered " + answered + ", expected 2025-11-25");
            session.notify("notifications/initialized", json::Object{});
            if (discover_lists(session, "2026-07-28")) result.failures.push_back("with the flag off, server/discover lists 2026-07-28");
            session.stop();
        }
    }
    {
        Session session({gm, "serve", "--run-dir", (sandbox / "on").string(), "--protocol-2026-07-28", "on"}, workspace, sandbox, 180000);
        if (!session.started()) {
            result.failures.push_back("the flagged serve did not start");
        } else {
            const std::string answered = text_at(initialize_as(session, "2026-07-28"), "result.protocolVersion");
            if (answered != "2026-07-28") result.failures.push_back("with the flag on, initialize 2026-07-28 answered " + answered + ", expected 2026-07-28");
            session.notify("notifications/initialized", json::Object{});
            if (!discover_lists(session, "2026-07-28")) result.failures.push_back("with the flag on, server/discover does not list 2026-07-28");
            if (!discover_lists(session, "2025-11-25")) result.failures.push_back("with the flag on, server/discover dropped 2025-11-25");
            session.stop();
        }
    }
    {
        Session session({gm, "serve", "--run-dir", (sandbox / "default").string(), "--protocol-2026-07-28", "on"}, workspace, sandbox, 180000);
        if (session.started()) {
            const std::string answered = text_at(initialize_as(session, "1999-01-01"), "result.protocolVersion");
            if (answered != "2025-11-25") result.failures.push_back("with the flag on, an unknown version answered " + answered + "; 2025-11-25 must stay the default");
            session.stop();
        }
    }
    const proc::Outcome refused = proc::run({gm, "serve", "--protocol-2026-07-28", "maybe"}, workspace, {}, 30000);
    if (refused.exit_code != 1 || refused.err.find("takes on or off") == std::string::npos)
        result.failures.push_back("--protocol-2026-07-28 maybe was not refused: exit " + std::to_string(refused.exit_code) + " " + refused.err.substr(0, 200));
    result.summary = "protocol 2026-07-28 sits behind --protocol-2026-07-28, off by default: off, initialize 2026-07-28 answers 2025-11-25 and server/discover omits it; on, initialize echoes 2026-07-28 and server/discover lists it after the 2025 versions; an unknown version still answers 2025-11-25; a value other than on or off is refused";
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}

}
