#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-cancel-wait";

json::Value content_json(const json::Value& message) {
    const json::Value* result = message.find("result");
    const json::Value* content = result != nullptr ? result->find("content") : nullptr;
    if (content == nullptr || !content->is_array() || content->as_array().empty()) return json::Value();
    const json::Value* text = content->as_array().front().find("text");
    if (text == nullptr || !text->is_string()) return json::Value();
    if (auto parsed = json::parse(text->as_string())) return *parsed;
    return json::Value();
}

std::size_t job_events(const json::Value& body, const std::string& job) {
    const json::Value* pending = body.find("pending");
    if (pending == nullptr || !pending->is_array()) return 0;
    std::size_t count = 0;
    for (const json::Value& entry : pending->as_array()) {
        if (text_at(entry, "kind") == "job" && text_at(entry, "job") == job) ++count;
    }
    return count;
}

}

CheckResult check_cancel_wait(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-cancel-wait-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    long long cancel_to_answer_ms = -1;
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
            tool_text(session, "run_code", json::Object{{"body", "return await gm.job_start({ job: 'cw-job', command: 'sleep 2; echo done', timeoutMs: 60000 });"}});

            const std::int64_t wait_id = session.send("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{{"waitMs", 30000}}}});
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            const auto cancel_at = std::chrono::steady_clock::now();
            session.notify("notifications/cancelled", json::Object{{"requestId", wait_id}, {"reason", "witness gave up"}});
            const std::int64_t next = session.send("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{{"waitMs", 10000}}}});
            const auto answered = session.await_reply(next, std::chrono::seconds(20));
            if (!answered) {
                result.failures.push_back("the next next_context was not answered");
            } else {
                cancel_to_answer_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - cancel_at).count();
                if (cancel_to_answer_ms >= 5000) result.failures.push_back("the next call waited " + std::to_string(cancel_to_answer_ms) + " ms after the cancel; expected it answered when the job event came");
                const json::Value body = content_json(*answered);
                const json::Value* notice = body.find("previousWaitCancelled");
                const json::Value* named = notice != nullptr ? notice->find("requestId") : nullptr;
                if (named == nullptr || !named->is_number() || static_cast<std::int64_t>(named->as_number()) != wait_id)
                    result.failures.push_back("the next reply does not name the cancelled wait: " + json::dump(notice != nullptr ? *notice : json::Value()));
                if (notice != nullptr && (text_at(*notice, "by.name") != kCheck || text_at(*notice, "why") != "witness gave up"))
                    result.failures.push_back("the notice does not say who and why: " + json::dump(*notice));
                if (job_events(body, "cw-job") != 1) result.failures.push_back("the job event was not delivered exactly once by the next next_context: " + std::to_string(job_events(body, "cw-job")));

                const std::int64_t after = session.send("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
                const auto again = session.await_reply(after, std::chrono::seconds(20));
                if (!again) {
                    result.failures.push_back("the follow-up next_context was not answered");
                } else {
                    const json::Value again_body = content_json(*again);
                    if (job_events(again_body, "cw-job") != 0) result.failures.push_back("the job event was delivered a second time");
                    if (again_body.find("previousWaitCancelled") != nullptr) result.failures.push_back("the cancelled-wait notice repeated on a later reply");
                }
            }
            if (session.await_reply(wait_id, std::chrono::milliseconds(1500))) result.failures.push_back("the cancelled wait was answered; the protocol says no reply");

            bool recorded = false;
            for (const json::Value& event : run_events(workspace / "runs" / "check" / "log.jsonl", "cancel")) {
                const json::Value* id = event.find("requestId");
                if (id != nullptr && id->is_number() && static_cast<std::int64_t>(id->as_number()) == wait_id && text_at(event, "outcome") == "ended the next_context wait; no reply is sent") recorded = true;
            }
            if (!recorded) result.failures.push_back("the run log has no cancel for the wait");
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "cancel at +500 ms of a 30000 ms wait; the next next_context answered " + std::to_string(cancel_to_answer_ms) + " ms after the cancel with the job event (once) and previousWaitCancelled naming the client (wall " + std::to_string(wall) + " s)";
    return result;
}

}
