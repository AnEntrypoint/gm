#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::size_t kShortReplyBytes = 8192;

}

CheckResult check_next_context_no_task(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("next-context-no-task");
    std::size_t events = 0;
    std::size_t bytes = 0;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-next-context-no-task");
            const std::string body = "for (let i = 0; i < 60; i += 1) await gm.read_file({ path: 'skill://gm/SKILL.md' }); await gm.job_start({ job: 'nc-job', command: 'echo ready' }); await gm.job_status({ job: 'nc-job', waitMs: 20000 }); return 'filled';";
            tool_json(session, "run_code", json::Object{{"body", body}});
            const json::Value reply = tool_json(session, "next_context", json::Object{{"full", true}});
            if (const json::Value* list = value_at(reply, "events"); list != nullptr && list->is_array()) events = list->as_array().size();
            bytes = json::dump(reply).size();
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (!started) return result;
    if (events > 0) result.failures.push_back("a next_context call in a run with no task replayed " + std::to_string(events) + " events");
    if (bytes > kShortReplyBytes) result.failures.push_back("a next_context call in a run with no task replied " + std::to_string(bytes) + " bytes, expected at most " + std::to_string(kShortReplyBytes));
    result.summary = "a next_context call in a run with no task replies with no events and " + std::to_string(bytes) + " bytes";
    return result;
}

}
