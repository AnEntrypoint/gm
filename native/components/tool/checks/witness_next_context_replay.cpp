#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kMarker = "REPLAY-MARKER-5c1e";

std::string replay_brief() {
    std::string brief = std::string(kMarker) + " the first run's brief. ";
    for (int i = 0; i < 1200; ++i) brief += "filler text for the brief. ";
    return brief;
}

std::string dump_or_absent(const json::Value& value, const std::string& key) {
    const json::Value* found = value.find(key);
    return found != nullptr ? json::dump(*found) : std::string("absent");
}

json::Value successor_feed(const json::Value& successor) {
    if (const json::Value* events = successor.find("events"); events != nullptr && !events->is_null()) return *events;
    if (const json::Value* items = successor.find("items"); items != nullptr && !items->is_null()) return *items;
    return json::Array{};
}

long long task_chars(const json::Value& successor) {
    if (const json::Value* chars = successor.find("taskChars"); chars != nullptr && chars->is_number()) return static_cast<long long>(chars->as_number());
    const json::Value* task = successor.find("task");
    if (task == nullptr || task->is_null()) return 0;
    return static_cast<long long>(task->is_string() ? task->as_string().size() : json::dump(*task).size());
}

}

CheckResult check_witness_next_context_replay(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-replay-check-" + std::to_string(started.time_since_epoch().count()));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const std::string brief = replay_brief();
    std::string first_run = "absent";
    std::string successor_run = "absent";
    bool finished = false;
    std::size_t feed_chars = 0;
    bool feed_has_brief = false;
    long long successor_task_chars = 0;
    {
        Session session(binary, workspace, sandbox, 180000, true, {"--build-dir", "none"});
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-replay-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            const json::Value first = tool_json(session, "next_context", json::Object{{"task", brief}});
            const json::Value closed = tool_json(session, "finish", json::Object{{"witness", "replay witness: the first run closed with its brief"}});
            const json::Value successor = tool_json(session, "next_context", json::Object{});
            first_run = dump_or_absent(first, "run");
            successor_run = dump_or_absent(successor, "run");
            const json::Value* done = closed.find("finished");
            finished = done != nullptr && done->is_bool() && done->as_bool();
            const std::string feed = json::dump(successor_feed(successor));
            feed_chars = feed.size();
            feed_has_brief = feed.find(kMarker) != std::string::npos;
            successor_task_chars = task_chars(successor);
            if (!finished || successor_run == first_run || feed_has_brief)
                result.failures.push_back("next-context-replay: the successor run replayed the closed run brief in its events (finished " + std::string(finished ? "true" : "false") +
                                          ", first run " + first_run + ", successor run " + successor_run + ", feed has brief " + std::string(feed_has_brief ? "true" : "false") + ")");
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "first run " + first_run + " finished " + std::string(finished ? "true" : "false") + "; successor run " + successor_run + "; brief " + std::to_string(brief.size()) +
                     " chars; successor feed " + std::to_string(feed_chars) + " chars, has brief " + std::string(feed_has_brief ? "true" : "false") + "; successor task " +
                     std::to_string(successor_task_chars) + " chars (wall " + std::to_string(wall) + " s)";
    return result;
}

}
