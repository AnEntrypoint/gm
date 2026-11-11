#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "check-cancel-record";
constexpr std::int64_t kStale = 987654;

void settle() { std::this_thread::sleep_for(std::chrono::milliseconds(500)); }

}

CheckResult check_cancel_record(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-cancel-record-" + std::to_string(stamp));
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
            const std::int64_t wait_id = session.send("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{{"waitMs", 30000}}}});
            settle();
            session.notify("notifications/cancelled", json::Object{{"requestId", wait_id}, {"reason", "client gave up"}});
            settle();
            session.notify("notifications/cancelled", json::Object{{"requestId", kStale}, {"reason", "stale"}});
            settle();

            const auto cancels = run_events(workspace / "runs" / "check" / "log.jsonl", "cancel");
            const json::Value* matched = nullptr;
            const json::Value* unmatched = nullptr;
            for (const json::Value& event : cancels) {
                const json::Value* id = event.find("requestId");
                if (id != nullptr && id->is_number() && static_cast<std::int64_t>(id->as_number()) == wait_id) matched = &event;
                if (id != nullptr && id->is_number() && static_cast<std::int64_t>(id->as_number()) == kStale) unmatched = &event;
            }
            if (cancels.size() != 2) result.failures.push_back("expected 2 cancel events, found " + std::to_string(cancels.size()));
            if (matched == nullptr) {
                result.failures.push_back("no cancel event for the waiting call");
            } else {
                if (text_at(*matched, "by.name") != kCheck || text_at(*matched, "by.version") != "1") result.failures.push_back("the cancel event must name the client that cancelled: " + json::dump(*matched));
                if (text_at(*matched, "why") != "client gave up") result.failures.push_back("the cancel event must carry the client's reason: " + json::dump(*matched));
                if (text_at(*matched, "outcome") != "ended the next_context wait; no reply is sent") result.failures.push_back("the matched cancel must say what gm did: " + json::dump(*matched));
            }
            if (unmatched == nullptr || text_at(*unmatched, "outcome") != "no call in flight with that id" || text_at(*unmatched, "why") != "stale")
                result.failures.push_back("the unmatched cancel must say so: " + (unmatched == nullptr ? std::string("missing") : json::dump(*unmatched)));
            if (!run_events(workspace / "runs" / "check" / "log.jsonl", "cancel-ignored").empty()) result.failures.push_back("the cancel-ignored event is replaced by cancel");
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "each cancel records who cancelled, why, and what gm did (wall " + std::to_string(wall) + " s)";
    return result;
}

}
