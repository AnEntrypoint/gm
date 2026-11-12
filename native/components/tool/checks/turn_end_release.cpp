#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {

#if defined(_WIN32)

CheckResult check_turn_end_release(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#else
namespace {

namespace fs = std::filesystem;

constexpr const char* kStubScript = R"JS(const fs = require('fs');
const readline = require('readline');
fs.appendFileSync(process.argv[2], process.pid + '\n');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch (error) { return; }
  if (request.id === undefined) return;
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '1' } } });
  } else if (request.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }] } });
  } else if (request.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'stub-echo' }], isError: false } });
  } else {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'no such method' } });
  }
}).on('close', () => process.exit(0));
)JS";

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::vector<long long> stub_pids(const fs::path& file) {
    std::vector<long long> pids;
    std::istringstream lines(read_text(file));
    std::string line;
    while (std::getline(lines, line)) {
        if (!line.empty()) pids.push_back(std::stoll(line));
    }
    return pids;
}

bool flag(const json::Value& value, const std::string& key, bool expected) {
    const json::Value* found = value.is_object() ? value.find(key) : nullptr;
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

void prepare(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                           {"clientInfo", json::Object{{"name", "turn-end-release-check"}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    tool_json(session, "next_context", json::Object{});
}

json::Value call_stub(Session& session) {
    return tool_json(session, "run_code", json::Object{{"body", "return await gm.stub_echo({});"}});
}

bool turn_end(const fs::path& binary, const fs::path& home, const fs::path& cwd, const std::string& session_id) {
    json::Value hook;
    hook.set("cwd", cwd.string()).set("session_id", session_id);
    const fs::path input = home / ("hook-" + session_id + ".json");
    std::ofstream(input) << json::dump(hook);
    const auto run = proc::run({"env", "HOME=" + home.string(), "sh", "-c", "exec \"$0\" turn-end < \"$1\"", binary, input.string()}, home, {}, 20000);
    return run.started && run.exit_code == 0;
}

bool wait_for_exit(const std::vector<long long>& pids, std::chrono::milliseconds limit) {
    const auto deadline = std::chrono::steady_clock::now() + limit;
    while (!alive_of(pids).empty()) {
        if (std::chrono::steady_clock::now() >= deadline) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    return true;
}

}

CheckResult check_turn_end_release(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-turn-end-release-" + std::to_string(stamp));
    const fs::path workspace = scratch / "ws";
    const fs::path home = scratch / "home";
    const fs::path other = scratch / "other";
    const fs::path stub = scratch / "stub.cjs";
    const fs::path pids = scratch / "stub.pids";
    const fs::path log = workspace / "runs" / "check" / "log.jsonl";
    fs::create_directories(workspace / ".gm");
    fs::create_directories(home);
    fs::create_directories(other);
    std::ofstream(stub) << kStubScript;
    const auto located = proc::run({"sh", "-c", "command -v node"}, scratch, {}, 20000);
    std::string node_path = located.out;
    while (!node_path.empty() && (node_path.back() == '\n' || node_path.back() == ' ')) node_path.pop_back();
    if (!located.started || located.exit_code != 0 || node_path.empty()) {
        result.failures.push_back("node is needed for the stub lazy server and was not found on PATH");
    } else {
        std::ofstream(workspace / ".gm" / "mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true},"stub":{"command":")" << node_path << R"(","args":[")" << stub.string() << R"(",")" << pids.string() << R"("],"lazy":true}}})";
        {
            Session off(binary, workspace, home, 180000, false);
            if (!off.started()) {
                result.failures.push_back("gm serve did not start from " + binary + " without the flag");
            } else {
                prepare(off);
                const json::Value first = call_stub(off);
                if (!flag(first, "ok", true) || json::dump(first).find("stub-echo") == std::string::npos) result.failures.push_back("the stub verb did not run with the flag off: " + json::dump(first).substr(0, 300));
                const std::vector<long long> started_pids = stub_pids(pids);
                if (started_pids.empty()) result.failures.push_back("the stub server did not start");
                if (!turn_end(binary, home, workspace, "check-off")) result.failures.push_back("gm turn-end failed with the flag off");
                std::this_thread::sleep_for(std::chrono::seconds(12));
                if (!started_pids.empty() && alive_of(started_pids).empty()) result.failures.push_back("the lazy client was released at the turn end with release_at_turn_end off");
            }
            off.stop();
        }
        const std::size_t before_session = stub_pids(pids).size();
        {
            Session on(binary, workspace, home, 180000, false, {"--release-at-turn-end", "yes"});
            if (!on.started()) {
                result.failures.push_back("gm serve did not start from " + binary + " with --release-at-turn-end yes");
            } else {
                prepare(on);
                const json::Value first = call_stub(on);
                if (!flag(first, "ok", true)) result.failures.push_back("the stub verb did not run with the flag on: " + json::dump(first).substr(0, 300));
                const std::vector<long long> live = stub_pids(pids);
                if (live.size() <= before_session) {
                    result.failures.push_back("the stub server did not start for the flagged worker");
                } else {
                    const long long pid = live.back();
                    std::this_thread::sleep_for(std::chrono::seconds(6));
                    if (alive_of({pid}).empty()) result.failures.push_back("the client connected after the earlier turn end was released by that marker");
                    if (!turn_end(binary, home, workspace, "check-on")) result.failures.push_back("gm turn-end failed with the flag on");
                    const auto released_at = std::chrono::steady_clock::now();
                    if (!wait_for_exit({pid}, std::chrono::seconds(15))) {
                        result.failures.push_back("the lazy client was not released within 15000 ms of the turn end");
                    } else {
                        const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - released_at).count();
                        result.summary += "released " + std::to_string(seconds) + " s after gm turn-end; ";
                    }
                    if (read_text(log).find("released at the end of the caller's turn") == std::string::npos) result.failures.push_back("the run log has no down event with the release reason");
                    const json::Value again = call_stub(on);
                    if (!flag(again, "ok", true) || json::dump(again).find("stub-echo") == std::string::npos) result.failures.push_back("the stub verb did not reconnect after the release: " + json::dump(again).substr(0, 300));
                    const std::vector<long long> reconnected = stub_pids(pids);
                    if (reconnected.size() <= live.size()) {
                        result.failures.push_back("no new stub process after the reconnect");
                    } else {
                        const long long next = reconnected.back();
                        std::this_thread::sleep_for(std::chrono::seconds(6));
                        if (alive_of({next}).empty()) result.failures.push_back("a call after the turn end was released by the earlier marker");
                        if (!turn_end(binary, home, other, "check-other")) result.failures.push_back("gm turn-end failed for another workspace");
                        std::this_thread::sleep_for(std::chrono::seconds(12));
                        if (alive_of({next}).empty()) result.failures.push_back("a marker for another workspace released this workspace's client");
                    }
                }
            }
            on.stop();
        }
    }
    const std::vector<long long> all = stub_pids(pids);
    if (!wait_for_exit(all, std::chrono::seconds(5))) {
        const std::vector<long long> stray = alive_of(all);
        result.failures.push_back(std::to_string(stray.size()) + " stub process(es) were still alive after gm serve stopped");
        kill_processes(stray);
    }
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary += "release is off by default; with --release-at-turn-end yes a workspace-keyed turn-end marker releases the lazy client, the next call reconnects, and another workspace's marker does not release it (wall " + std::to_string(wall) + " s)";
    return result;
}

}
#endif
