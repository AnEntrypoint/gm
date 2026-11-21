#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

std::string text_or_missing(const json::Value& value, const char* key) {
    const json::Value* found = value_at(value, key);
    return found != nullptr && found->is_string() ? found->as_string() : std::string("<missing>");
}

std::string numbered_lines(std::size_t count) {
    std::string text;
    for (std::size_t i = 1; i <= count; ++i) text += "line" + std::to_string(i) + "\n";
    return text;
}

}

CheckResult check_job_status_output(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("job-status-output");
    const std::string expected_body = numbered_lines(100);
    std::string body_output;
    std::string body_tail;
    std::string shell_tail_one;
    std::string shell_tail_two;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-job-status-output");
            const std::string start = "await gm.read_file({ path: 'skill://gm/SKILL.md' }); await new Promise((resolve) => setTimeout(resolve, 2000)); return Array.from({ length: 100 }, (_, i) => 'line' + (i + 1)).join('\\n') + '\\n';";
            const json::Value started_body = tool_json(session, "run_code", json::Object{{"body", start}, {"timeoutMs", 1000}});
            const json::Value* background = started_body.find("background");
            if (background == nullptr || !background->is_string()) {
                result.failures.push_back("the body did not start as a background run: " + json::dump(started_body).substr(0, 240));
            } else {
                const std::string job = background->as_string();
                const std::string poll = "const s = await gm.job_status({ job: '" + job + "', waitMs: 60000 }); const t = await gm.job_status({ job: '" + job + "', waitMs: 1000, tail: 2 }); return { output: s.output, tail: t.output };";
                const json::Value answer = output_value(tool_json(session, "run_code", json::Object{{"body", poll}}));
                body_output = text_or_missing(answer, "output");
                body_tail = text_or_missing(answer, "tail");
            }
            const std::string shell = "await gm.job_start({ job: 'shell-lines', command: 'seq 1 100' }); const one = await gm.job_status({ job: 'shell-lines', waitMs: 60000, tail: 1 }); const two = await gm.job_status({ job: 'shell-lines', waitMs: 1000, tail: 2 }); return { one: one.output, two: two.output };";
            const json::Value shell_answer = output_value(tool_json(session, "run_code", json::Object{{"body", shell}}));
            shell_tail_one = text_or_missing(shell_answer, "one");
            shell_tail_two = text_or_missing(shell_answer, "two");
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (!started) return result;
    if (body_output != expected_body) result.failures.push_back("job_status of a body returned its output, not its value: " + body_output.substr(0, 120));
    if (body_tail != "line99\nline100\n") result.failures.push_back("job_status tail: 2 of a body did not return its last two lines: " + body_tail.substr(0, 120));
    if (shell_tail_one != "100\n") result.failures.push_back("job_status tail: 1 of a shell job did not return its last line: " + shell_tail_one.substr(0, 120));
    if (shell_tail_two != "99\n100\n") result.failures.push_back("job_status tail: 2 of a shell job did not return its last two lines: " + shell_tail_two.substr(0, 120));
    result.summary = "job_status returns a body's value and a tail of N lines for a body and for a shell job";
    return result;
}

}
