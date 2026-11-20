#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_job_running_progress(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("job-running-progress");
    std::string answer_text;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-job-running-progress");
            const std::string body = R"(await gm.read_file({ path: 'skill://gm/SKILL.md' }); await new Promise((resolve) => setTimeout(resolve, 6000)); return 'late-value';)";
            const json::Value started_body = tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 1000}});
            const json::Value* background = started_body.find("background");
            if (background == nullptr || !background->is_string()) {
                result.failures.push_back("the body did not start as a background run: " + json::dump(started_body).substr(0, 240));
            } else {
                const std::string poll = "const s = await gm.job_status({ job: '" + background->as_string() + "', value: true }); return { state: s.state, hasValue: s.value !== undefined, progress: s.progress ?? '' };";
                const json::Value answer = output_value(tool_json(session, "run_code", json::Object{{"body", poll}}));
                answer_text = json::dump(answer);
            }
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer_text.find("\"state\":\"running\"") == std::string::npos) result.failures.push_back("the job is not running when polled: " + answer_text.substr(0, 240));
    if (answer_text.find("\"hasValue\":false") == std::string::npos) result.failures.push_back("a running job reports a value before its body returns: " + answer_text.substr(0, 240));
    if (answer_text.find("\"progress\":\"\"") != std::string::npos) result.failures.push_back("a running job reports no progress for the calls it has made: " + answer_text.substr(0, 240));
    result.summary = "a running background body reports its state running, no value, and its progress so far";
    return result;
}

}
