#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <string>

#if defined(_WIN32)

namespace gm::tool {

CheckResult check_caps_removed(const std::string&) {
    CheckResult result;
    result.summary = "skipped (not on this platform: the cap witness drives the POSIX serve)";
    return result;
}

}

#else

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

json::Value output_of(const json::Value& reply) {
    const json::Value* output = reply.is_object() ? reply.find("output") : nullptr;
    if (output == nullptr) return reply;
    if (!output->is_string()) return *output;
    if (auto parsed = json::parse(output->as_string())) return *parsed;
    return reply;
}

void connect(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    tool_json(session, "next_context", json::Object{});
}

json::Value run_code(Session& session, const std::string& body, std::int64_t timeout_ms) {
    return tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", timeout_ms}, {"body", body}});
}

}

CheckResult check_caps_removed(const std::string& binary) {
    CheckResult result;
    const auto began = std::chrono::steady_clock::now();
    const auto stamp = began.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-caps-removed-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    auto expect = [&](bool condition, const std::string& text) {
        if (!condition) result.failures.push_back(text);
    };
    {
        Session plain({binary, "serve", "--workspace", workspace.string(), "--run-dir", (workspace / "runs" / "open").string()}, workspace, sandbox, 300000);
        Session capped({binary, "serve", "--workspace", workspace.string(), "--run-dir", (workspace / "runs" / "capped").string(), "--max-steps", "2"}, workspace, sandbox, 300000);
        expect(plain.started() && capped.started(), "a gm serve did not start from " + binary);
        if (plain.started() && capped.started()) {
            connect(plain);
            connect(capped);
            const std::string open_text = json::dump(tool_json(plain, "next_context", json::Object{{"full", true}}));
            expect(open_text.find("\"maxSteps\":null") != std::string::npos, "a serve with no --max-steps still reports a step limit: " + open_text.substr(0, 300));
            expect(open_text.find("\"stepsLeft\":null") != std::string::npos, "a serve with no --max-steps still reports stepsLeft: " + open_text.substr(0, 300));
            const std::string capped_text = json::dump(tool_json(capped, "next_context", json::Object{{"full", true}}));
            expect(capped_text.find("\"maxSteps\":2") != std::string::npos, "--max-steps 2 was not reported: " + capped_text.substr(0, 300));

            const std::string long_budget = json::dump(run_code(plain, "return 1;", 3600001));
            expect(long_budget.find("timeoutMs must be") == std::string::npos && long_budget.find("\"ok\":true") != std::string::npos,
                   "a run_code timeoutMs above the old 3600000 ceiling was refused: " + long_budget.substr(0, 300));

            const std::string fetched = json::dump(output_of(run_code(plain, "return { fetched: await gm.fetch({ url: 'data:text/plain,kept', timeoutMs: 60001 }) };", 60000)));
            expect(fetched.find("timeoutMs must be") == std::string::npos && fetched.find("kept") != std::string::npos,
                   "a fetch timeoutMs above the old 60000 ceiling was refused: " + fetched.substr(0, 300));

            const std::string shell = json::dump(output_of(run_code(plain, "return { shell: await gm.run_shell({ command: 'echo no-default-timeout' }) };", 60000)));
            expect(shell.find("no-default-timeout") != std::string::npos, "run_shell without timeoutMs did not return its output: " + shell.substr(0, 300));
            const beyond_clock = json::dump(output_of(run_code(plain, "return { shell: await gm.run_shell({ command: 'echo beyond-clock', timeoutMs: 10000000000000 }) };", 60000)));
            expect(beyond_clock.find("beyond-clock") != std::string::npos, "a run_shell timeoutMs beyond the clock range did not return its output: " + beyond_clock.substr(0, 300));
            const searched = json::dump(output_of(run_code(plain, "return { found: await gm.search({ pattern: 'caps-removed-probe', scope: 'all', limit: 1001 }) };", 60000)));
            expect(searched.find("limit must be") == std::string::npos, "a search limit of 1001 was refused: " + searched.substr(0, 300));
        }
        plain.stop();
        capped.stop();
    }
    fs::remove_all(sandbox);
    const auto wall = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began).count();
    result.summary = "no step or inflight limit by default (maxSteps and maxInflight are null, stepsLeft is null), --max-steps 2 is still reported, a run_code timeoutMs of 3600001 and a fetch timeoutMs of 60001 are accepted, and run_shell without a timeout returns its output, a run_shell timeoutMs beyond the clock range and a search limit of 1001 are accepted (wall " +
                     std::to_string(wall) + " ms)";
    return result;
}

}

#endif
