#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-read-lines-pack";

}

CheckResult check_read_lines_pack(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-read-lines-pack-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        std::string text;
        for (int line = 1; line <= 60; ++line) text += "line " + std::to_string(line) + " " + std::string(300, 'y') + "\n";
        std::ofstream(workspace / "lines.txt", std::ios::binary) << text;
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            start_session(session, kCheck);
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const r = await gm.read_file({ path: 'lines.txt', offset: 0, limit: 60 }); const out = String(r.output ?? ''); return { length: out.length, lines: out.split('\n').length - 1, cut: out.includes('<<<gm-cut'), truncated: r.truncated, nextOffset: r.nextOffset ?? null, hint: r.hint ?? null };)js"}}));
            const double length = number_at(reply, "length");
            const double lines = number_at(reply, "lines");
            const double next = number_at(reply, "nextOffset");
            const json::Value* cut = value_at(reply, "cut");
            const json::Value* truncated = value_at(reply, "truncated");
            const std::string hint = text_at(reply, "hint");
            if (length > 12000.0 || length <= 11000.0)
                result.failures.push_back("a line page of 60 lines of 300 characters does not fill the 12000-character page: " + std::to_string(length) + " characters");
            if (cut == nullptr || !cut->is_bool() || cut->as_bool())
                result.failures.push_back("a line page within the cap was cut in band: " + json::dump(reply).substr(0, 200));
            if (truncated == nullptr || !truncated->is_bool() || !truncated->as_bool())
                result.failures.push_back("a line page that stops before the end is not truncated: " + json::dump(reply).substr(0, 200));
            if (lines != next)
                result.failures.push_back("the page holds " + std::to_string(lines) + " lines but nextOffset is " + std::to_string(next));
            if (hint.find("offset: " + std::to_string(static_cast<long long>(next))) == std::string::npos)
                result.failures.push_back("the hint of a line page does not continue at its nextOffset: " + hint);
            result.summary = "a line page of 60 lines of 300 characters holds whole lines up to the 12000-character cap, is not cut in band, and its hint continues at nextOffset";
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
