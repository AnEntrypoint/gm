#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-run-shell-script-hint";

}

CheckResult check_run_shell_script_hint(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-run-shell-script-hint-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const s = await gm.run_shell({ command: "python3 -c 'for i in range(300): print(\"row\", i, \"k\" * 20)'" }); return { truncated: s.truncated, hint: s.hint ?? null, outputPath: s.outputPath ?? null };)js"}}));
            const json::Value* truncated = value_at(reply, "truncated");
            const std::string hint = text_at(reply, "hint");
            if (truncated == nullptr || !truncated->is_bool() || !truncated->as_bool())
                result.failures.push_back("a script that printed 300 lines was not cut in band: " + json::dump(reply).substr(0, 200));
            if (hint.find("gm.read_file") == std::string::npos || hint.find("fewer lines") == std::string::npos)
                result.failures.push_back("the cut hint of a script run does not name gm.read_file and fewer lines: " + hint);
            result.summary = "a script run through run_shell that prints more lines than the reply shows names outputPath, gm.read_file and fewer lines in its cut hint";
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
