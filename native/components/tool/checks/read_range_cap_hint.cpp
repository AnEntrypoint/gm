#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-read-range-cap-hint";

}

CheckResult check_read_range_cap_hint(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-read-range-cap-hint-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        std::string text;
        for (int line = 1; text.size() < 30000; ++line) text += "line " + std::to_string(line) + " " + std::string(20, 'x') + "\n";
        std::ofstream(workspace / "big.txt", std::ios::binary) << text;
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const r = await gm.read_file({ path: 'big.txt', offset: 0, limit: 20000 }); return { truncated: r.truncated, hint: r.hint ?? null, nextOffset: r.nextOffset ?? null };)js"}}));
            const json::Value* truncated = value_at(reply, "truncated");
            const std::string hint = text_at(reply, "hint");
            if (truncated == nullptr || !truncated->is_bool() || !truncated->as_bool())
                result.failures.push_back("a ranged read of limit 20000 was not cut in band: " + json::dump(reply).substr(0, 200));
            if (hint.find("6000") == std::string::npos || hint.find("nextOffset") == std::string::npos)
                result.failures.push_back("the cut hint of a read with limit above the 6000-character cap does not name the cap and nextOffset: " + hint);
            result.summary = "a ranged read_file with limit 20000 is cut at the 6000-character in-band cap and its hint names the cap and nextOffset for the next page";
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
