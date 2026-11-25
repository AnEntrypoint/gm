#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-read-whole-cap-hint";

}

CheckResult check_read_whole_cap_hint(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-read-whole-cap-hint-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        std::string text;
        for (int line = 1; text.size() < 8000; ++line) text += "int value" + std::to_string(line) + " = " + std::to_string(line) + ";  // source line\n";
        std::ofstream(workspace / "main.txt", std::ios::binary) << text;
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const r = await gm.read_file({ path: 'main.txt' }); return { truncated: r.truncated, hint: r.hint ?? null };)js"}}));
            const json::Value* truncated = value_at(reply, "truncated");
            const std::string hint = text_at(reply, "hint");
            if (truncated == nullptr || !truncated->is_bool() || !truncated->as_bool())
                result.failures.push_back("a whole read of an 8000-character file was not cut in band: " + json::dump(reply).substr(0, 200));
            if (hint.find("offset") == std::string::npos || hint.find("6000") == std::string::npos)
                result.failures.push_back("the cut hint of a whole read does not give the cap and offset paging: " + hint);
            if (hint.find("full: true") != std::string::npos)
                result.failures.push_back("the cut hint of a whole read still suggests full: true: " + hint);
            result.summary = "a whole read of a file over the 6000-character cap is cut in band, and its hint gives the cap and offset paging without full: true";
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
