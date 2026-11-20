#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kTask = "check that an inherited task names its closed run";

}

CheckResult check_next_context_provenance(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("next-context-provenance");
    std::string closed;
    bool started = false;
    json::Value next;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-next-context-provenance");
            const json::Value first = tool_json(session, "next_context", json::Object{{"task", kTask}});
            if (const json::Value* run = value_at(first, "run"); run != nullptr && run->is_string()) closed = run->as_string();
            tool_json(session, "finish", json::Object{{"witness", "the run is finished so its successor inherits the task"}});
            next = tool_json(session, "next_context", json::Object{});
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (!started) return result;
    const json::Value* run = value_at(next, "run");
    const json::Value* task = value_at(next, "task");
    const json::Value* task_from = value_at(next, "taskFrom");
    if (closed.empty()) result.failures.push_back("the first run reported no run id");
    if (run == nullptr || !run->is_string() || run->as_string() == closed) result.failures.push_back("the next_context after finish did not open a successor run");
    if (task == nullptr || !task->is_string() || task->as_string() != kTask) result.failures.push_back("the successor run did not inherit the task");
    if (task_from == nullptr || !task_from->is_string() || task_from->as_string() != "closed run " + closed) {
        result.failures.push_back("the successor's reply does not name the closed run its inherited task came from: " + json::dump(next).substr(0, 300));
    }
    result.summary = "a successor run whose task is inherited from its closed run names that run as taskFrom on its next_context reply";
    return result;
}

}
