#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kCheck = "owner-identity-check";

void open_session(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", kCheck}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
}

}

CheckResult check_owner_identity(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-owner-identity-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    const fs::path run_dir = workspace / "runs" / "check";
    fs::create_directories(workspace);
    std::string run_id;
    std::string resumed_text;
    {
        Session first(binary, workspace, sandbox, 180000, true);
        if (!first.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            open_session(first);
            first.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            const json::Value opened = tool_json(first, "next_context", json::Object{});
            run_id = text_at(opened, "run");
            if (run_id.empty()) result.failures.push_back("the first server did not open a run: " + json::dump(opened).substr(0, 200));
        }
        first.stop();
    }
    if (result.failures.empty()) {
        proc::SpawnOptions options(sandbox);
        auto holder = proc::Child::spawn({"sleep", "120"}, options);
        if (!holder) {
            result.failures.push_back("the owner holder process did not start");
        } else {
            {
                std::ofstream owner(run_dir / "owner", std::ios::trunc);
                owner << (*holder)->pid() << ":1\n";
            }
            Session second(binary, workspace, sandbox, 180000, true);
            if (!second.started()) {
                result.failures.push_back("the restarted server did not start");
            } else {
                open_session(second);
                second.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
                const json::Value resumed = tool_json(second, "next_context", json::Object{});
                resumed_text = json::dump(resumed);
                if (resumed_text.find("belongs to another live connection") != std::string::npos)
                    result.failures.push_back("run " + run_id + " was not adopted: its owner pid " + std::to_string((*holder)->pid()) + " has another start time, so it is not alive, but the server called it foreign: " + resumed_text.substr(0, 240));
                if (text_at(resumed, "run") != run_id)
                    result.failures.push_back("the restarted server did not resume run " + run_id + ": " + resumed_text.substr(0, 240));
            }
            second.stop();
            (*holder)->kill();
        }
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a run whose owner names a live pid with another start time is adopted after a restart (wall " + std::to_string(wall) + " s)";
    return result;
}

CheckResult check_run_task_kept(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-run-task-kept-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    const fs::path run_dir = workspace / "runs" / "check";
    fs::create_directories(workspace);
    const std::string logged = "the logged task of the open run";
    const std::string replacement = "a replacement task from a new serve";
    std::string run_id;
    {
        Session first(binary, workspace, sandbox, 180000, true, {"--task", logged});
        if (!first.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            open_session(first);
            first.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            const json::Value opened = tool_json(first, "next_context", json::Object{});
            run_id = text_at(opened, "run");
            if (run_id.empty()) {
                result.failures.push_back("the first server did not open a run: " + json::dump(opened).substr(0, 200));
            } else if (text_at(opened, "task") != logged) {
                result.failures.push_back("the first server's task is not its --task: " + json::dump(opened).substr(0, 240));
            }
        }
        first.stop();
    }
    if (result.failures.empty()) {
        proc::SpawnOptions options(sandbox);
        auto holder = proc::Child::spawn({"sleep", "120"}, options);
        if (!holder) {
            result.failures.push_back("the owner holder process did not start");
        } else {
            {
                std::ofstream owner(run_dir / "owner", std::ios::trunc);
                owner << (*holder)->pid() << ":1\n";
            }
            Session second(binary, workspace, sandbox, 180000, true, {"--task", replacement});
            if (!second.started()) {
                result.failures.push_back("the second server did not start");
            } else {
                open_session(second);
                second.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
                const json::Value resumed = tool_json(second, "next_context", json::Object{});
                if (text_at(resumed, "run") != run_id) result.failures.push_back("the second server did not resume run " + run_id + ": " + json::dump(resumed).substr(0, 240));
                if (text_at(resumed, "task") != logged) result.failures.push_back("run " + run_id + " took the --task of a new serve in place of its logged task: " + json::dump(resumed).substr(0, 240));
            }
            second.stop();
            (*holder)->kill();
        }
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "an open run that a new serve reopens keeps its logged task; the --task of the new serve does not replace it (wall " + std::to_string(wall) + " s)";
    return result;
}

}
