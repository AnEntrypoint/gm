#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-inline-cap-raised";

}

CheckResult check_inline_cap_raised(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-inline-cap-raised-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        std::string text;
        for (int line = 1; text.size() < 9000; ++line) text += "value " + std::to_string(line) + " " + std::string(40, 'z') + "\n";
        std::ofstream(workspace / "mid.txt", std::ios::binary) << text;
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const r = await gm.read_file({ path: 'mid.txt' }); return { truncated: r.truncated, length: String(r.output ?? '').length };)js"}}));
            const json::Value* truncated = value_at(reply, "truncated");
            const double length = number_at(reply, "length");
            if (truncated == nullptr || !truncated->is_bool() || truncated->as_bool())
                result.failures.push_back("a whole read of a 9000-character file was cut, so the in-band cap is below 9000: " + json::dump(reply).substr(0, 200));
            if (length < 8500)
                result.failures.push_back("a whole read of a 9000-character file returned " + std::to_string(length) + " characters in band");
            result.summary = "a whole read of a 9000-character file comes back in band in full, so the in-band cap is above 9000 characters";
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
