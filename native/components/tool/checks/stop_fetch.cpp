#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::chrono::milliseconds kHold{50000};
constexpr std::chrono::milliseconds kCloseWithin{5000};

bool flag(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

}

CheckResult check_stop_fetch(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-stop-fetch-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    long long close_ms = -1;
    {
        HoldServer server(kHold, "late");
        if (server.port() == 0) {
            result.failures.push_back("the local test server did not listen");
        } else {
            Session session(binary, workspace, sandbox, 180000, true);
            if (!session.started()) {
                result.failures.push_back("gm serve did not start from " + binary);
            } else {
                session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                      {"clientInfo", json::Object{{"name", "gm-stop-fetch-check"}, {"version", "1"}}}});
                session.notify("notifications/initialized", json::Object{});
                session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
                tool_json(session, "next_context", json::Object{});
                const std::string body = "return await gm.fetch({ url: 'http://127.0.0.1:" + std::to_string(server.port()) + "/', timeoutMs: 60000 });";
                const json::Value started_reply = tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 1000}, {"body", body}});
                if (value_at(started_reply, "background") == nullptr)
                    result.failures.push_back("the fetch body did not go to the background: " + json::dump(started_reply).substr(0, 200));
                for (int i = 0; i < 100 && !server.requested(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));
                if (!server.requested()) result.failures.push_back("the server never received the fetch");
                const auto stop_at = std::chrono::steady_clock::now();
                const json::Value finished = tool_json(session, "finish", json::Object{{"witness", "stop fetch check"}, {"stopBackground", true}});
                if (!flag(finished, "ok", true) || !flag(finished, "finished", true)) result.failures.push_back("finish did not end the run: " + json::dump(finished).substr(0, 200));
                const auto deadline = stop_at + kCloseWithin;
                while (!server.closed_at() && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(std::chrono::milliseconds(100));
                const auto closed = server.closed_at();
                if (!closed) {
                    result.failures.push_back("the stopped body's fetch kept its connection open for 5000 ms after finish (the server answers at 50000 ms)");
                } else {
                    close_ms = std::chrono::duration_cast<std::chrono::milliseconds>(*closed - stop_at).count();
                }
            }
            session.stop();
        }
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a background fetch in a body closed its connection " + std::to_string(close_ms) + " ms after finish stopped the run; the server answers at 50000 ms (wall " + std::to_string(wall) + " s)";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_stop_fetch(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
