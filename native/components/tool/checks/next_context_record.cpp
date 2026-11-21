#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-next-context-record";
constexpr double kWaitMs = 1000;

const json::Value* result_for(const std::vector<json::Value>& results, const json::Value& action) {
    const double seq = number_at(action, "seq");
    for (const json::Value& result : results) {
        if (number_at(result, "actionSeq") == seq) return &result;
    }
    return nullptr;
}

}

CheckResult check_next_context_record(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-next-context-record-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", kCheck}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            tool_text(session, "next_context", json::Object{{"waitMs", 1000}});
            tool_text(session, "next_context", json::Object{});
        }
        session.stop();
    }
    const fs::path log = workspace / "runs" / "check" / "log.jsonl";
    std::vector<json::Value> actions;
    std::vector<json::Value> results;
    for (const json::Value& event : run_events(log, "action")) {
        if (text_at(event, "tool") == "next_context") actions.push_back(event);
    }
    for (const json::Value& event : run_events(log, "result")) {
        if (text_at(event, "tool") == "next_context") results.push_back(event);
    }
    if (actions.size() != 3) {
        result.failures.push_back("expected 3 next_context actions in the journal, found " + std::to_string(actions.size()));
    } else {
        if (actions[0].find("waitMs") != nullptr) result.failures.push_back("a next_context call with no waitMs records a waitMs: " + json::dump(actions[0]));
        if (actions[2].find("waitMs") != nullptr) result.failures.push_back("a next_context call with no waitMs records a waitMs: " + json::dump(actions[2]));
        if (number_at(actions[1], "waitMs") != kWaitMs) result.failures.push_back("a next_context call with waitMs 1000 records a different waitMs: " + json::dump(actions[1]));
        const json::Value* audit = actions[1].find("args");
        if (audit == nullptr || audit->find("waitMs") != nullptr) result.failures.push_back("waitMs must stay out of the audit args: " + json::dump(actions[1]));
        const json::Value* waited = result_for(results, actions[1]);
        if (waited == nullptr) {
            result.failures.push_back("the waiting call has no result record");
        } else {
            const json::Value* reply = waited->find("reply");
            if (reply == nullptr || !reply->is_string() || reply->as_string() != "no-event") result.failures.push_back("the waiting call on an empty queue must record reply no-event: " + json::dump(*waited));
            if (number_at(*waited, "durMs") < kWaitMs * 0.9) result.failures.push_back("the waiting call must record its duration near 1000 ms: " + json::dump(*waited));
        }
        const json::Value* plain = result_for(results, actions[2]);
        if (plain == nullptr) {
            result.failures.push_back("the call with no waitMs has no result record");
        } else {
            const json::Value* reply = plain->find("reply");
            if (reply == nullptr || !reply->is_string() || reply->as_string() == "no-event") result.failures.push_back("a call with no waitMs must not record no-event: " + json::dump(*plain));
        }
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a next_context call records its waitMs and reply kind, and a call with no waitMs records none (wall " + std::to_string(wall) + " s)";
    return result;
}

}
