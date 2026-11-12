#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {

#if defined(_WIN32)

CheckResult check_mcp_args(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#else
namespace {

namespace fs = std::filesystem;

constexpr const char* kStubScript = R"JS(const readline = require('readline');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch (error) { return; }
  if (request.id === undefined) return;
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '1' } } });
  } else if (request.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } });
  } else if (request.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'received ' + JSON.stringify(request.params.arguments) }], isError: false } });
  } else {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'no such method' } });
  }
});
)JS";

void prepare(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                           {"clientInfo", json::Object{{"name", "mcp-args-check"}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    tool_json(session, "next_context", json::Object{});
}

}

CheckResult check_mcp_args(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-mcp-args-" + std::to_string(stamp));
    const fs::path workspace = scratch / "ws";
    const fs::path home = scratch / "home";
    const fs::path stub = scratch / "stub.cjs";
    fs::create_directories(workspace / ".gm");
    fs::create_directories(home);
    std::ofstream(stub) << kStubScript;
    const auto located = proc::run({"sh", "-c", "command -v node"}, scratch, {}, 20000);
    std::string node_path = located.out;
    while (!node_path.empty() && (node_path.back() == '\n' || node_path.back() == ' ')) node_path.pop_back();
    if (!located.started || located.exit_code != 0 || node_path.empty()) {
        result.failures.push_back("node is needed for the stub MCP server and was not found on PATH");
    } else {
        std::ofstream(workspace / ".gm" / "mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true},"stub":{"command":")" << node_path << R"(","args":[")" << stub.string() << R"("]}}})";
        Session session(binary, workspace, home, 180000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            prepare(session);
            const json::Value forwarded = tool_json(session, "run_code", json::Object{{"body", "return await gm.stub_echo({ text: 'hi', extra: 2 });"}});
            const std::string text = json::dump(forwarded);
            if (text.find("received") == std::string::npos || text.find("extra") == std::string::npos) {
                result.failures.push_back("an MCP tool did not receive an argument its schema does not declare: " + text.substr(0, 300));
            }
            const json::Value refused = tool_json(session, "run_code", json::Object{{"body", "return await gm.read_file({ bogus: 1 });"}});
            if (json::dump(refused).find("unknown argument bogus") == std::string::npos) {
                result.failures.push_back("a native verb no longer refuses an argument it does not declare: " + json::dump(refused).substr(0, 300));
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "an MCP tool receives arguments its schema does not declare, and a native verb still refuses them by name (wall " + std::to_string(wall) + " s)";
    return result;
}

}
#endif
