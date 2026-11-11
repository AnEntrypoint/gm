#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kBody =
    "const cat = await gm.run_shell({ command: 'cat', timeoutMs: 10000 });\n"
    "const read = await gm.run_shell({ command: \"echo remote-line | sh -c 'read x; echo got:$x'\", timeoutMs: 10000 });\n"
    "const pipe = await gm.run_shell({ command: 'echo payload | cat', timeoutMs: 10000 });\n"
    "await gm.job_start({ job: 'stdin-cat', command: 'cat', timeoutMs: 10000 });\n"
    "await gm.job_start({ job: 'stdin-read', command: \"echo remote-line | sh -c 'read x; echo got:$x'\", timeoutMs: 10000 });\n"
    "const jobCat = await gm.job_status({ job: 'stdin-cat', waitMs: 10000 });\n"
    "const jobRead = await gm.job_status({ job: 'stdin-read', waitMs: 10000 });\n"
    "return { cat, read: read.output, pipe: pipe.output, jobCat: { state: jobCat.state, exitCode: jobCat.exitCode, output: jobCat.output }, jobRead: { state: jobRead.state, exitCode: jobRead.exitCode, output: jobRead.output } };";

bool flag_at(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

}

CheckResult check_shell_stdin(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-stdin-check-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    long long elapsed = -1;
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-stdin-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            const auto run_started = std::chrono::steady_clock::now();
            const json::Value reply = tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 60000}, {"body", kBody}});
            elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - run_started).count();
            const json::Value out = output_value(reply);
            if (!out.is_object()) {
                result.failures.push_back("run_code did not return the body value: " + json::dump(out).substr(0, 200));
            } else {
                if (!flag_at(out, "cat.ok", true) || flag_at(out, "cat.timedOut", true)) result.failures.push_back("cat with no input hung or failed: " + json::dump(value_at(out, "cat") != nullptr ? *value_at(out, "cat") : json::Value()).substr(0, 200));
                if (elapsed >= 9000) result.failures.push_back("the three shell calls took " + std::to_string(elapsed) + " ms; a hang would hit the 10000 ms shell timeout");
                if (text_at(out, "read") != "got:remote-line\n") result.failures.push_back("a stdin-reading command returned " + json::dump(value_at(out, "read") != nullptr ? *value_at(out, "read") : json::Value()) + ", expected got:remote-line");
                if (text_at(out, "pipe") != "payload\n") result.failures.push_back("piped input returned " + json::dump(value_at(out, "pipe") != nullptr ? *value_at(out, "pipe") : json::Value()) + ", expected payload");
                const json::Value* job_cat = value_at(out, "jobCat");
                if (job_cat == nullptr || text_at(*job_cat, "state") != "exited" || text_at(*job_cat, "output") != "" || value_at(*job_cat, "exitCode") == nullptr || value_at(*job_cat, "exitCode")->as_number() != 0)
                    result.failures.push_back("job cat with no input did not exit cleanly: " + json::dump(job_cat != nullptr ? *job_cat : json::Value()).substr(0, 200));
                const json::Value* job_read = value_at(out, "jobRead");
                std::string read_output = job_read != nullptr ? text_at(*job_read, "output") : std::string();
                std::string trimmed;
                for (const char c : read_output) {
                    if (c != '\r' && c != '\n' && c != ' ' && c != '\t') trimmed.push_back(c);
                }
                if (job_read == nullptr || text_at(*job_read, "state") != "exited" || trimmed != "got:remote-line")
                    result.failures.push_back("a job that reads stdin returned " + json::dump(job_read != nullptr ? *job_read : json::Value()).substr(0, 200));
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "cat with no input returned in " + std::to_string(elapsed) + " ms; a stdin-reading command got its input and printed its output (wall " + std::to_string(wall) + " s)";
    return result;
}

}
