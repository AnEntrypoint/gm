#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <future>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::chrono::seconds kReply{10};

json::Value parse_or_null(const std::string& text) {
    if (auto parsed = json::parse(text)) return *parsed;
    return json::Value();
}

}

CheckResult check_early_run_code(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-early-run-code-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    long long elapsed_ms = -1;
    long long finish_ms = -1;
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-early-run-code"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});

            const auto early_started = std::chrono::steady_clock::now();
            auto early = std::async(std::launch::async, [&session] {
                return tool_text(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 60000}, {"body", "return { early: 1 };"}});
            });
            if (early.wait_for(kReply) != std::future_status::ready) {
                result.failures.push_back("early call: a run_code sent before the first next_context got no reply in 10000 ms");
            } else {
                elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - early_started).count();
                const json::Value body = parse_or_null(early.get());
                const json::Value* output = body.find("output");
                const json::Value parsed_output = output != nullptr && output->is_string() ? parse_or_null(output->as_string()) : output != nullptr ? *output : json::Value();
                const json::Value* early_value = parsed_output.find("early");
                const json::Value* ok = body.find("ok");
                const json::Value* notice = body.find("rulesNotice");
                if (ok == nullptr || !ok->is_bool() || !ok->as_bool() || early_value == nullptr || !early_value->is_number() || early_value->as_number() != 1)
                    result.failures.push_back("early call: the body did not run: " + json::dump(body).substr(0, 200));
                if (notice == nullptr || !notice->is_string() || notice->as_string().find("before the first next_context") == std::string::npos)
                    result.failures.push_back("early call: the rules notice is missing: " + json::dump(body).substr(0, 200));
            }

            const auto finish_started = std::chrono::steady_clock::now();
            auto finish = std::async(std::launch::async, [&session] {
                return tool_text(session, "finish", json::Object{{"witness", "early finish check"}});
            });
            if (finish.wait_for(kReply) != std::future_status::ready) {
                result.failures.push_back("early finish: a finish sent before the first next_context got no reply in 10000 ms");
            } else {
                finish_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - finish_started).count();
                const json::Value body = parse_or_null(finish.get());
                const json::Value* ok = body.find("ok");
                const json::Value* finished = body.find("finished");
                if (ok == nullptr || !ok->is_bool() || !ok->as_bool() || finished == nullptr || !finished->is_bool() || !finished->as_bool())
                    result.failures.push_back("early finish: the run did not end: " + json::dump(body).substr(0, 200));
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a run_code sent before the first next_context ran at once in " + std::to_string(elapsed_ms) + " ms, with the rules notice; an early finish ended the run in " +
                     std::to_string(finish_ms) + " ms (wall " + std::to_string(wall) + " s)";
    return result;
}

}
