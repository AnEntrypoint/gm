#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-run-shell-dump-cd-hint";

}

CheckResult check_run_shell_dump_cd_hint(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-run-shell-dump-cd-hint-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        std::string text;
        for (int line = 1; line <= 300; ++line) text += "dump line " + std::to_string(line) + " " + std::string(20, 'd') + "\n";
        std::ofstream(workspace / "dump.txt", std::ios::binary) << text;
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const s = await gm.run_shell({ command: 'cd . ; cat dump.txt' }); return { truncated: s.truncated, hint: s.hint ?? null };)js"}}));
            const json::Value* truncated = value_at(reply, "truncated");
            const std::string hint = text_at(reply, "hint");
            if (truncated == nullptr || !truncated->is_bool() || !truncated->as_bool())
                result.failures.push_back("a cd-then-cat of a 300-line file through run_shell was not cut in band: " + json::dump(reply).substr(0, 200));
            if (hint.find("gm.read_file") == std::string::npos || hint.find("offset") == std::string::npos)
                result.failures.push_back("the cut hint of a cd-then-cat dump does not name gm.read_file with offset: " + hint);
            result.summary = "a cd, then cat, through run_shell (separated by ;) that is cut in band names gm.read_file with offset and limit";
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
