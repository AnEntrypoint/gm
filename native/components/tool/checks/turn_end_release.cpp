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

bool wait_for_exit(const std::vector<long long>& pids, std::chrono::milliseconds limit) {
    const auto deadline = std::chrono::steady_clock::now() + limit;
    while (!alive_of(pids).empty()) {
        if (std::chrono::steady_clock::now() >= deadline) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
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
    const fs::path stub = scratch / "stub.cjs";
    const fs::path pids = scratch / "stub.pids";
    const fs::path log = workspace / "runs" / "check" / "log.jsonl";
    fs::create_directories(workspace / ".gm");
    fs::create_directories(home);
    std::ofstream(stub) << kStubScript;
    const auto located = proc::run({"sh", "-c", "command -v node"}, scratch, {}, 20000);
    std::string node_path = located.out;
    while (!node_path.empty() && (node_path.back() == '\n' || node_path.back() == ' ')) node_path.pop_back();
    if (!located.started || located.exit_code != 0 || node_path.empty()) {
        result.failures.push_back("node is needed for the stub lazy server and was not found on PATH");
    } else {
        std::ofstream(workspace / ".gm" / "mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true},"stub":{"command":")" << node_path << R"(","args":[")" << stub.string() << R"(",")" << pids.string() << R"("],"lazy":true}}})";
        double finish_seconds = -1;
        double close_seconds = -1;
        {
            Session run(binary, workspace, home, 180000, false);
            if (!run.started()) {
                result.failures.push_back("gm serve did not start from " + binary);
            } else {
                prepare(run);
                const json::Value first = call_stub(run);
                if (!flag(first, "ok", true) || json::dump(first).find("stub-echo") == std::string::npos) result.failures.push_back("the stub verb did not run: " + json::dump(first).substr(0, 300));
                const std::vector<long long> started_pids = stub_pids(pids);
                if (started_pids.empty()) {
                    result.failures.push_back("the stub server did not start");
                } else {
                    const long long pid = started_pids.back();
                    std::this_thread::sleep_for(std::chrono::seconds(2));
                    if (alive_of({pid}).empty()) result.failures.push_back("the lazy client was gone before the run finished");
                    const json::Value finished = tool_json(run, "finish", json::Object{{"witness", "turn-end release check: finish releases the lease"}});
                    const auto finished_at = std::chrono::steady_clock::now();
                    if (!flag(finished, "finished", true)) result.failures.push_back("finish did not end the run: " + json::dump(finished).substr(0, 300));
                    if (!wait_for_exit({pid}, std::chrono::seconds(15))) {
                        result.failures.push_back("the lazy client was not released by finish within 15000 ms");
                    } else {
                        finish_seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - finished_at).count();
                    }
                    if (read_text(log).find("released when the run ended") == std::string::npos) result.failures.push_back("the run log has no down event with the run-end reason");
                }
            }
            run.stop();
        }
        {
            Session second(binary, workspace, home, 180000, false);
            if (!second.started()) {
                result.failures.push_back("gm serve did not start for the second connection");
            } else {
                prepare(second);
                const json::Value again = call_stub(second);
                if (!flag(again, "ok", true) || json::dump(again).find("stub-echo") == std::string::npos) result.failures.push_back("the stub verb did not run on the second connection: " + json::dump(again).substr(0, 300));
                const std::vector<long long> live = stub_pids(pids);
                if (live.empty() || alive_of({live.back()}).empty()) {
                    result.failures.push_back("the stub server did not start for the second connection");
                } else {
                    const long long pid = live.back();
                    const auto closed_at = std::chrono::steady_clock::now();
                    second.close_input();
                    if (!wait_for_exit({second.pid()}, std::chrono::seconds(15))) result.failures.push_back("gm serve did not exit after its transport closed");
                    if (!wait_for_exit({pid}, std::chrono::seconds(15))) {
                        result.failures.push_back("the lazy client was not released when the transport closed");
                    } else {
                        close_seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - closed_at).count();
                    }
                    if (read_text(log).find("released when the session closed") == std::string::npos) result.failures.push_back("the run log has no down event with the session-close reason");
                }
            }
            second.stop();
        }
        if (finish_seconds >= 0) result.summary += "finish released the lease " + std::to_string(finish_seconds) + " s after it was called; ";
        if (close_seconds >= 0) result.summary += "a closed transport released it " + std::to_string(close_seconds) + " s after close; ";
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
    result.summary += "the MCP path: a run's finish and a closed transport each release the lazy client, with its own reason in the run log (wall " + std::to_string(wall) + " s)";
    return result;
}

}
#endif
