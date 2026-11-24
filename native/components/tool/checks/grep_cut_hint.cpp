#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-grep-cut-hint";

}

CheckResult check_grep_cut_hint(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-grep-cut-hint-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const s = await gm.run_shell({ command: "for i in $(seq 1 400); do echo line-$i-padding-padding-padding-padding-padding; done | grep line" }); return { truncated: s.truncated, hint: s.hint ?? null, outputPath: s.outputPath ?? null };)js"}}));
            const json::Value* truncated = value_at(reply, "truncated");
            const std::string hint = text_at(reply, "hint");
            if (truncated == nullptr || !truncated->is_bool() || !truncated->as_bool())
                result.failures.push_back("a grep over 400 lines was not cut in band: " + json::dump(reply).substr(0, 200));
            if (hint.find("gm.grep") == std::string::npos)
                result.failures.push_back("the cut hint of a grep does not name gm.grep, the bounded search: " + hint);
            result.summary = "a run_shell grep whose output is cut names gm.grep with pattern, root and limit as its bounded search, and the cut keeps outputPath";
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
