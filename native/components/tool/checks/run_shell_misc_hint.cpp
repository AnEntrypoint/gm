#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-run-shell-misc-hint";

}

CheckResult check_run_shell_misc_hint(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-run-shell-misc-hint-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace / "many");
    {
        for (int file = 0; file < 300; ++file) std::ofstream(workspace / "many" / ("entry-" + std::to_string(file) + ".txt"));
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const s = await gm.run_shell({ command: 'ls many' }); return { truncated: s.truncated, hint: s.hint ?? null, outputPath: s.outputPath ?? null };)js"}}));
            const json::Value* truncated = value_at(reply, "truncated");
            const std::string hint = text_at(reply, "hint");
            if (truncated == nullptr || !truncated->is_bool() || !truncated->as_bool())
                result.failures.push_back("an ls of 300 entries was not cut in band: " + json::dump(reply).substr(0, 200));
            if (hint.find("gm.read_file") == std::string::npos || hint.find("outputPath") == std::string::npos)
                result.failures.push_back("the cut hint of a misc command does not name outputPath and gm.read_file: " + hint);
            result.summary = "an ls of 300 entries through run_shell is cut in band and its hint names outputPath and gm.read_file";
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
