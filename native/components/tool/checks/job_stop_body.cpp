#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

std::string text_of(const json::Value& value, const char* key) {
    const json::Value* found = value_at(value, key);
    return found != nullptr && found->is_string() ? found->as_string() : std::string("<missing>");
}

}

CheckResult check_job_stop_body(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("job-stop-body");
    std::string reason;
    std::string state;
    std::string error;
    bool stopped_ok = false;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-job-stop-body");
            const std::string start = "await new Promise((resolve) => setTimeout(resolve, 60000)); return 'late';";
            const json::Value started_body = tool_json(session, "run_code", json::Object{{"body", start}, {"timeoutMs", 1000}});
            const json::Value* background = started_body.find("background");
            if (background == nullptr || !background->is_string()) {
                result.failures.push_back("the body did not start as a background run: " + json::dump(started_body).substr(0, 240));
            } else {
                const std::string job = background->as_string();
                const std::string stop = "const s = await gm.job_stop({ job: '" + job + "' }); const t = await gm.job_status({ job: '" + job + "', waitMs: 20000 }); return { ok: s.ok === true, reason: s.reason, error: s.error, state: t.state };";
                const json::Value answer = output_value(tool_json(session, "run_code", json::Object{{"body", stop}}));
                const json::Value* ok = value_at(answer, "ok");
                stopped_ok = ok != nullptr && ok->is_bool() && ok->as_bool();
                reason = text_of(answer, "reason");
                state = text_of(answer, "state");
                error = text_of(answer, "error");
            }
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (!started) return result;
    if (!stopped_ok) result.failures.push_back("job_stop of a background run did not succeed: " + error);
    if (reason != "cancelled") result.failures.push_back("job_stop of a background run did not report reason cancelled: " + reason);
    if (state != "killed") result.failures.push_back("the background run was not killed after job_stop: state " + state);
    result.summary = "job_stop ends a background run: ok, reason cancelled, state " + state;
    return result;
}

}
