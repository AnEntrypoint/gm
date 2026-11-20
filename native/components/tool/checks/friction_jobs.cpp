#include "gm/tool.hpp"
#include "support.hpp"

namespace gm::tool {

CheckResult check_friction_jobs(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("friction-jobs");
    const std::filesystem::path ws = sandbox / "ws";
    std::filesystem::create_directories(ws);
    const std::string prefix = "await gm.read_file({ path: 'skill://gm/SKILL.md' }); ";
    {
        Session session(binary, ws, sandbox, 240000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            support::start_session(session, "gm-friction-jobs-check");
            const json::Value spin = tool_json(session, "run_code",
                                               json::Object{{"format", "esm"}, {"timeoutMs", 1000},
                                                            {"body", prefix + "const end = Date.now() + 2000; while (Date.now() < end) {} return { answer: 42 };"}});
            const std::string job = text_at(spin, "background");
            if (job.empty()) {
                result.failures.push_back("the 2 s body did not move to background: " + json::dump(spin).substr(0, 200));
            } else {
                const json::Value status = output_value(tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 60000},
                                                                                                    {"body", "return await gm.job_status({ job: '" + job + "', waitMs: 30000 });"}}));
                const json::Value* answer = value_at(status, "value.answer");
                if (answer == nullptr || !answer->is_number() || answer->as_number() != 42)
                    result.failures.push_back("job_status of a finished body without value: true did not return its value: " + json::dump(status).substr(0, 240));
            }
            tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 30000},
                                                        {"body", prefix + "await gm.job_start({ job: 'friction-sleep', command: 'sleep 30' }); return 'started';"}});
            const json::Value done = tool_json(session, "finish", json::Object{{"witness", "friction jobs witness"}});
            const json::Value* killed = value_at(done, "jobsKilled");
            bool named = false;
            if (killed != nullptr && killed->is_array()) {
                for (const json::Value& entry : killed->as_array()) {
                    if (text_at(entry, "job") == "friction-sleep" && text_at(entry, "reason") == "run-ended") named = true;
                }
            }
            if (!named) result.failures.push_back("finish did not report the running job as killed with reason run-ended: " + json::dump(done).substr(0, 240));
        }
    }
    result.summary = "job_status returns a finished body's small value without value: true, and finish reports a job it killed at run end with its reason";
    return result;
}

}
