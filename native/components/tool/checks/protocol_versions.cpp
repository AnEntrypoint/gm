#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>
#include <thread>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

const std::vector<std::string> kVersions{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"};
const std::string kLatest = "2025-11-25";
const std::string kUnknown = "1999-01-01";
const std::string kRefused = "2024-01-01";
constexpr std::chrono::milliseconds kReplyWait{60000};
constexpr std::chrono::milliseconds kEventWait{60000};
constexpr std::size_t kStderrTail = 2000;

constexpr const char* kFakeServer = R"SH(version="$1"
mode="$2"
caps=',"capabilities":{"tools":{}}'
[ "$mode" = no-capabilities ] && caps=''
info='{"name":"fake","version":"1.0.0"}'
[ "$mode" = no-server-version ] && info='{"name":"fake"}'
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *'"id":'*) ;;
    *) continue ;;
  esac
  rest="${line#*\"id\":}"
  rest="${rest# }"
  id="${rest%%[,\}]*}"
  case "$line" in
    *'"method":"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"%s"%s,"serverInfo":%s}}\n' "$id" "$version" "$caps" "$info" ;;
    *'"method":"tools/list"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[]}}\n' "$id" ;;
    *) printf '{"jsonrpc":"2.0","id":%s,"result":{}}\n' "$id" ;;
  esac
done
)SH";

bool supported(const std::string& version) {
    return std::find(kVersions.begin(), kVersions.end(), version) != kVersions.end();
}

bool alive(long long pid) {
    if (pid <= 0) return false;
    std::ifstream stat("/proc/" + std::to_string(pid) + "/stat");
    std::string line;
    if (!std::getline(stat, line)) return false;
    const auto close = line.rfind(')');
    return close != std::string::npos && close + 2 < line.size() && line[close + 2] != 'Z';
}

std::string tail(const std::string& text) {
    std::string trimmed = text;
    while (!trimmed.empty() && (trimmed.back() == '\n' || trimmed.back() == ' ' || trimmed.back() == '\r')) trimmed.pop_back();
    if (trimmed.size() > kStderrTail) trimmed = trimmed.substr(trimmed.size() - kStderrTail);
    return trimmed.empty() ? "(empty)" : trimmed;
}

std::string cause_of(const Session& session) {
    if (alive(session.pid())) return {};
    return "engine exited before it answered; stderr: " + tail(session.stderr_text());
}

std::vector<std::string> engine_argv(const std::string& binary, const fs::path& workspace, const fs::path& run_dir, const fs::path& config) {
    return {binary, "serve", "--workspace", workspace.string(), "--run-dir", run_dir.string(), "--mcp-config", config.string()};
}

struct ServerOutcome {
    std::string asked;
    std::optional<json::Value> reply;
    std::string cause;
};

struct ClientCase {
    std::string label;
    std::string version;
    std::string mode;
};

struct ClientOutcome {
    std::optional<json::Value> event;
    std::string cause;
};

ServerOutcome server_case(const std::string& binary, const fs::path& scratch, const std::string& asked, std::size_t index) {
    ServerOutcome outcome{asked, std::nullopt, {}};
    const fs::path dir = scratch / ("server-" + std::to_string(index));
    const fs::path workspace = dir / "ws";
    std::error_code ec;
    fs::create_directories(workspace, ec);
    Session session(engine_argv(binary, workspace, workspace / "run", scratch / "quiet-mcp.json"), workspace, dir);
    if (!session.started()) {
        outcome.cause = "gm serve did not start from " + binary;
        return outcome;
    }
    const std::int64_t id = session.send("initialize", json::Object{{"protocolVersion", asked}, {"capabilities", json::Object{}},
                                                                     {"clientInfo", json::Object{{"name", "protocol-versions-check"}, {"version", "1"}}}});
    if (id >= 0) outcome.reply = session.await_reply(id, kReplyWait);
    if (!outcome.reply) outcome.cause = cause_of(session);
    session.stop();
    return outcome;
}

std::optional<json::Value> find_event(const fs::path& log) {
    for (const json::Value& entry : run_events(log, "mcp-server")) {
        const std::string state = text_at(entry, "state");
        if (text_at(entry, "server") == "fake" && (state == "connected" || state == "failed")) return entry;
    }
    return std::nullopt;
}

ClientOutcome client_case(const std::string& binary, const fs::path& scratch, const ClientCase& item, std::size_t index) {
    ClientOutcome outcome;
    const fs::path dir = scratch / ("client-" + std::to_string(index));
    const fs::path workspace = dir / "ws";
    const fs::path run_dir = workspace / "run";
    const fs::path config = dir / "mcp.json";
    std::error_code ec;
    fs::create_directories(workspace, ec);
    const json::Value servers = json::Object{
        {"mcpServers", json::Object{{"playwriter", json::Object{{"disabled", true}}},
                                    {"fake", json::Object{{"command", "/bin/sh"},
                                                          {"args", json::Array{(scratch / "fake-server.sh").string(), item.version, item.mode}}}}}}};
    std::ofstream(config) << json::dump(servers);
    Session session(engine_argv(binary, workspace, run_dir, config), workspace, dir);
    if (!session.started()) {
        outcome.cause = "gm serve did not start from " + binary;
        return outcome;
    }
    const fs::path log = run_dir / "log.jsonl";
    const auto deadline = std::chrono::steady_clock::now() + kEventWait;
    outcome.event = find_event(log);
    while (!outcome.event && alive(session.pid()) && std::chrono::steady_clock::now() < deadline) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        outcome.event = find_event(log);
    }
    if (!outcome.event) outcome.cause = cause_of(session);
    session.stop();
    return outcome;
}

std::string with_cause(const std::string& text, const std::string& cause) {
    return cause.empty() ? text : text + "; " + cause;
}

}

CheckResult check_protocol_versions(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-protocol-versions-" + std::to_string(stamp));
    fs::create_directories(scratch);
    std::ofstream(scratch / "quiet-mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    std::ofstream(scratch / "fake-server.sh") << kFakeServer;

    std::vector<std::string> asked = kVersions;
    asked.push_back(kUnknown);
    std::vector<ServerOutcome> served(asked.size());
    std::vector<ClientCase> cases;
    for (const std::string& version : kVersions) cases.push_back({"client accepts " + version, version, "ok"});
    cases.push_back({"client refuses " + kRefused, kRefused, "ok"});
    cases.push_back({"client refuses a result without capabilities", kLatest, "no-capabilities"});
    cases.push_back({"client refuses a result without serverInfo.version", kLatest, "no-server-version"});
    std::vector<ClientOutcome> events(cases.size());
    {
        std::vector<std::jthread> workers;
        for (std::size_t i = 0; i < asked.size(); ++i)
            workers.emplace_back([&, i] { served[i] = server_case(binary, scratch, asked[i], i); });
        for (std::size_t i = 0; i < cases.size(); ++i)
            workers.emplace_back([&, i] { events[i] = client_case(binary, scratch, cases[i], i); });
    }

    for (const ServerOutcome& outcome : served) {
        const std::string expected = supported(outcome.asked) ? outcome.asked : kLatest;
        const std::string label = "server asked " + outcome.asked;
        if (!outcome.reply || outcome.reply->find("error") != nullptr) {
            result.failures.push_back(with_cause(label + ": no initialize result: " + (outcome.reply ? json::dump(*outcome.reply) : std::string("null")), outcome.cause));
            continue;
        }
        const json::Value* found = outcome.reply->find("result");
        const json::Value reply_result = found != nullptr ? *found : json::Value(json::Object{});
        const json::Value* version = reply_result.find("protocolVersion");
        if (version == nullptr || !version->is_string() || version->as_string() != expected)
            result.failures.push_back(label + ": protocolVersion is " + (version ? json::dump(*version) : std::string("undefined")) + ", expected " + expected);
        const json::Value* capabilities = reply_result.find("capabilities");
        if (capabilities == nullptr || !capabilities->is_object()) result.failures.push_back(label + ": capabilities is not an object");
        if (text_at(reply_result, "serverInfo.version").empty()) result.failures.push_back(label + ": serverInfo.version is not a non-empty string");
    }

    for (std::size_t i = 0; i < cases.size(); ++i) {
        const ClientCase& item = cases[i];
        const ClientOutcome& outcome = events[i];
        if (!outcome.event) {
            result.failures.push_back(with_cause(item.label + ": no mcp-server event after " + std::to_string(kEventWait.count()) + " ms", outcome.cause));
            continue;
        }
        const std::string state = text_at(*outcome.event, "state");
        const std::string version = text_at(*outcome.event, "protocolVersion");
        const std::string error = text_at(*outcome.event, "error");
        if (item.mode == "ok" && supported(item.version)) {
            if (state != "connected" || version != item.version)
                result.failures.push_back(item.label + ": state " + state + ", protocolVersion " + version + (error.empty() ? std::string() : ", error " + error));
        } else if (state != "failed") {
            result.failures.push_back(item.label + ": state " + state + ", expected failed" + (error.empty() ? std::string() : " (error " + error + ")"));
        }
    }

    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    const std::string count = std::to_string(kVersions.size());
    result.summary = "server echoes the " + count + " supported versions, answers " + kUnknown + " with " + kLatest +
                     ", every initialize result has capabilities and serverInfo.version; client connects all " + count + " versions, refuses " + kRefused +
                     ", refuses a result without capabilities and one without serverInfo.version (wall " + std::to_string(wall) + " s)";
    return result;
}

}
