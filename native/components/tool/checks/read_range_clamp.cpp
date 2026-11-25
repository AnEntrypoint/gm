#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-read-range-clamp";

}

CheckResult check_read_range_clamp(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-read-range-clamp-" + std::to_string(stamp));
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
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", R"js(const r = await gm.read_file({ path: 'big.txt', unit: 'chars', offset: 0, limit: 20000 }); return { length: String(r.output ?? '').length, nextOffset: r.nextOffset ?? null, hint: r.hint ?? null };)js"}}));
            const double length = number_at(reply, "length");
            const double next = number_at(reply, "nextOffset");
            const std::string hint = text_at(reply, "hint");
            if (length != 12000.0)
                result.failures.push_back("a chars read of limit 20000 returned " + std::to_string(length) + " characters, not one 12000-character page: " + json::dump(reply).substr(0, 200));
            if (next != 12000.0)
                result.failures.push_back("the page of a chars read over the cap gives nextOffset " + std::to_string(next) + ", not 12000");
            if (hint.find("offset: 12000") == std::string::npos)
                result.failures.push_back("the hint of a clamped chars page does not continue at offset 12000: " + hint);
            result.summary = "a chars read_file with limit 20000 returns one 12000-character page, with nextOffset 12000 and a hint that continues from it";
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
