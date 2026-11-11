#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <optional>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kToken = "STATE_SCOPE_ALOOP_TOKEN";

void write_file(const fs::path& file, const std::string& text) {
    fs::create_directories(file.parent_path());
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    out << text;
}

bool flag_ok(const json::Value& value) {
    const json::Value* ok = value_at(value, "ok");
    return ok != nullptr && ok->is_bool() && ok->as_bool();
}

std::string text_of(const json::Value* value) {
    if (value == nullptr) return {};
    return value->is_string() ? value->as_string() : json::dump(*value);
}

std::optional<json::Value> grep_body(Session& session, const std::string& label, const std::string& body, std::vector<std::string>& failures) {
    const json::Value reply = tool_json(session, "run_code", json::Object{{"body", body}});
    if (!flag_ok(reply)) {
        failures.push_back(label + ": run_code refused: " + text_of(value_at(reply, "error")));
        return std::nullopt;
    }
    return output_value(reply);
}

}

CheckResult check_grep_state_scope(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-state-scope-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    write_file(workspace / ".gitignore", ".gm/\n");
    write_file(workspace / "src" / "app.js", "export const app = 1;\n");
    proc::run({"git", "init", "-q"}, workspace, {}, 30000);
    proc::run({"git", "add", ".gitignore", "src"}, workspace, {}, 30000);
    write_file(workspace / ".gm" / "witness-out" / "aloop.log", std::string("step 1 ") + kToken + " witnessed\n");
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "grep-state-scope-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{{"task", "grep state scope check"}});
            const std::string token = kToken;

            if (const auto named = grep_body(session, "named file, scope all", "return await gm.grep({ pattern: '" + token + "', path: '.gm/witness-out/aloop.log', scope: 'all', limit: 20 });", result.failures)) {
                if (text_of(value_at(*named, "output")).find(token + " witnessed") == std::string::npos)
                    result.failures.push_back("named file, scope all: the state-directory file was not searched: " + json::dump(*named).substr(0, 300));
            }
            if (const auto dir = grep_body(session, "named directory, scope all", "return await gm.grep({ pattern: '" + token + "', path: '.gm/witness-out', scope: 'all', limit: 20 });", result.failures)) {
                if (text_of(value_at(*dir, "output")).find(token + " witnessed") == std::string::npos)
                    result.failures.push_back("named directory, scope all: the state-directory files were not searched: " + json::dump(*dir).substr(0, 300));
            }
            if (const auto whole = grep_body(session, "whole root, scope all", "return await gm.grep({ pattern: '" + token + "', scope: 'all', limit: 20 });", result.failures)) {
                if (text_of(value_at(*whole, "output")).find(token) != std::string::npos)
                    result.failures.push_back("whole root, scope all: the state directory is searched by a whole-root scan, which the documented skip forbids");
            }
            if (const auto plain = grep_body(session, "named file, default scope", "return await gm.grep({ pattern: '" + token + "', path: '.gm/witness-out/aloop.log', limit: 20 });", result.failures)) {
                if (flag_ok(*plain) || text_of(value_at(*plain, "output")).find(token) != std::string::npos)
                    result.failures.push_back("named file, default scope: expected a refusal, got " + json::dump(*plain).substr(0, 300));
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "scope all reads a state-directory file and directory named by path; a whole-root scope all still skips them; the default scope still refuses the file (wall " + std::to_string(wall) + " s)";
    return result;
}

}
