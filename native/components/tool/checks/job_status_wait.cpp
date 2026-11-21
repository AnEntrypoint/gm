#include "gm/tool.hpp"
#include "support.hpp"

#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <system_error>

namespace gm::tool {
namespace {

std::int64_t number_after(const std::string& answer, const std::string& key) {
    const std::string needle = "\"" + key + "\":";
    const std::size_t at = answer.find(needle);
    if (at == std::string::npos) return -1;
    return std::atoll(answer.c_str() + at + needle.size());
}

std::string text_after(const std::string& answer, const std::string& key) {
    const std::string needle = "\"" + key + "\":\"";
    const std::size_t at = answer.find(needle);
    if (at == std::string::npos) return {};
    const std::size_t begin = at + needle.size();
    const std::size_t end = answer.find('"', begin);
    return answer.substr(begin, end == std::string::npos ? std::string::npos : end - begin);
}

}

CheckResult check_job_status_wait(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("job-status-wait");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-job-status-wait");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); await gm.job_start({ job: 'jsw-quick', command: 'sleep 1', timeoutMs: 60000 }); await gm.job_start({ job: 'jsw-long', command: 'sleep 200', timeoutMs: 300000 }); const t0 = Date.now(); const quick = await gm.job_status({ job: 'jsw-quick', waitMs: 60000 }); const quickMs = Date.now() - t0; const t1 = Date.now(); const long = await gm.job_status({ job: 'jsw-long', waitMs: 84000 }); const longMs = Date.now() - t1; await gm.job_stop({ job: 'jsw-long' }); return { quickMs, quickState: quick.state, longMs, longState: long.state };)JS";
            const json::Value reply = tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 100000}});
            answer = json::dump(output_value(reply));
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    const std::int64_t quick_ms = number_after(answer, "quickMs");
    const std::int64_t long_ms = number_after(answer, "longMs");
    if (text_after(answer, "quickState") != "exited") result.failures.push_back("a job that ends inside the wait must report exited: " + answer.substr(0, 320));
    if (quick_ms < 0 || quick_ms >= 30000) result.failures.push_back("a wait on a job that ends at once must return when the job ends, it took " + std::to_string(quick_ms) + " ms");
    if (text_after(answer, "longState") != "running") result.failures.push_back("a job still running after the full wait must report running: " + answer.substr(0, 320));
    if (long_ms < 83000) result.failures.push_back("job_status with waitMs 84000 on a running job returned after " + std::to_string(long_ms) + " ms; the wait must run its full time");
    result.summary = "job_status waits its full waitMs while the job runs (84 s asked, " + std::to_string(long_ms) + " ms taken) and returns when the job ends (" + std::to_string(quick_ms) + " ms for a job that ends at once)";
    return result;
}

}
