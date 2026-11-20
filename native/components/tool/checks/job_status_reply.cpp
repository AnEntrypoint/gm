#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::size_t kValueChars = 19000;
constexpr long long kReplyLimitBytes = 4096;

}

CheckResult check_job_status_reply(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-job-status-reply-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    long long bytes = -1;
    bool has_value = true;
    long long value_chars = -1;
    std::string state;
    std::size_t value_read = 0;
    {
        Session session(binary, workspace, sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-job-status-reply"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            const std::string body = "await new Promise((resolve) => setTimeout(resolve, 2000)); return 'ended ' + 'x'.repeat(" + std::to_string(kValueChars) + ");";
            const json::Value started_body = tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 1000}});
            const json::Value* background = started_body.find("background");
            if (background == nullptr || !background->is_string()) {
                result.failures.push_back("the body did not start as a background run: " + json::dump(started_body).substr(0, 240));
            } else {
                const std::string job = background->as_string();
                const std::string poll = "const s = await gm.job_status({ job: '" + job + "', waitMs: 60000 }); return { state: s.state, bytes: JSON.stringify(s).length, hasValue: Object.prototype.hasOwnProperty.call(s, 'value'), valueChars: s.valueChars };";
                const json::Value answer = output_value(tool_json(session, "run_code", json::Object{{"body", poll}}));
                if (const json::Value* v = answer.find("state"); v && v->is_string()) state = v->as_string();
                if (const json::Value* v = answer.find("bytes"); v && v->is_number()) bytes = static_cast<long long>(v->as_number());
                if (const json::Value* v = answer.find("hasValue"); v && v->is_bool()) has_value = v->as_bool();
                if (const json::Value* v = answer.find("valueChars"); v && v->is_number()) value_chars = static_cast<long long>(v->as_number());
                const std::string read = "const s = await gm.job_status({ job: '" + job + "', waitMs: 60000, value: true }); return { value: s.value };";
                const json::Value full = output_value(tool_json(session, "run_code", json::Object{{"body", read}}));
                if (const json::Value* v = full.find("value"); v && v->is_string()) value_read = v->as_string().size();
            }
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (state != "exited") result.failures.push_back("the job_status poll answered state " + state + ", expected exited");
    if (bytes < 0 || bytes > kReplyLimitBytes) result.failures.push_back("a job_status poll of a body with a " + std::to_string(kValueChars) + " character value replied " + std::to_string(bytes) + " bytes, over " + std::to_string(kReplyLimitBytes));
    if (has_value) result.failures.push_back("a job_status poll without value: true carried the value");
    if (value_chars < static_cast<long long>(kValueChars)) result.failures.push_back("a job_status poll did not report valueChars of at least " + std::to_string(kValueChars) + ": " + std::to_string(value_chars));
    if (value_read < kValueChars) result.failures.push_back("a job_status poll with value: true returned " + std::to_string(value_read) + " characters, expected at least " + std::to_string(kValueChars));
    result.summary = "a job_status poll of a body with a " + std::to_string(kValueChars) + " character value replied " + std::to_string(bytes) + " bytes without the value (valueChars " + std::to_string(value_chars) + "), and value: true returned " + std::to_string(value_read) + " characters";
    return result;
}

}
