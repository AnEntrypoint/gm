#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <system_error>
#include <thread>

#if !defined(_WIN32)
#include <csignal>
#include <signal.h>
#endif

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::uint64_t kWatchdogMs = 180000;

fs::path entry_workspace(const fs::path& sandbox) {
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace / ".gm");
    std::ofstream(workspace / ".gm" / "mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    return workspace;
}

std::vector<std::string> printed_entry(const std::string& binary) { return {fs::absolute(binary).string(), "serve"}; }

std::vector<std::string> tool_names(const json::Value& listed) {
    std::vector<std::string> names;
    const json::Value* tools = value_at(listed, "result.tools");
    if (tools == nullptr || !tools->is_array()) return names;
    for (const json::Value& tool : tools->as_array()) names.push_back(text_at(tool, "name"));
    return names;
}

bool contains(const std::vector<std::string>& names, const std::string& wanted) {
    return std::find(names.begin(), names.end(), wanted) != names.end();
}

std::string stamped_stop_line(const fs::path& workspace, const std::string& wanted) {
    std::error_code ec;
    for (const auto& entry : fs::recursive_directory_iterator(workspace / "runs", ec)) {
        if (entry.path().filename() != "relay.log") continue;
        std::ifstream in(entry.path());
        for (std::string line; std::getline(in, line);) {
            const std::size_t space = line.find(' ');
            if (space == std::string::npos || space == 0) continue;
            if (!std::all_of(line.begin(), line.begin() + static_cast<std::ptrdiff_t>(space), [](char c) { return c >= '0' && c <= '9'; })) continue;
            if (line.substr(space + 1) == wanted) return line;
        }
    }
    return {};
}

}

CheckResult check_serve_entry_connects(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = fs::temp_directory_path() / ("gm-serve-entry-" + std::to_string(stamp));
    const fs::path workspace = entry_workspace(sandbox);
    const std::vector<std::string> argv = printed_entry(binary);
    {
        Session session(argv, workspace, sandbox, kWatchdogMs);
        if (!session.started()) {
            result.failures.push_back("the printed entry did not start: " + argv.front() + " serve");
        } else {
            const json::Value initialized = session.rpc("initialize", json::Object{{"protocolVersion", "2025-11-25"}, {"capabilities", json::Object{}},
                                                                                   {"clientInfo", json::Object{{"name", "gm-serve-entry-check"}, {"version", "1"}}}});
            if (text_at(initialized, "result.serverInfo.name") != "gm") result.failures.push_back("initialize did not answer as gm: " + json::dump(initialized).substr(0, 240));
            session.notify("notifications/initialized", json::Object{});
            const std::vector<std::string> names = tool_names(session.rpc("tools/list", json::Object{}));
            if (!contains(names, "run_code")) result.failures.push_back("tools/list has no run_code");
            if (!contains(names, "next_context")) result.failures.push_back("tools/list has no next_context");
            const json::Value skill = session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            if (value_at(skill, "result.contents") == nullptr) result.failures.push_back("resources/read of skill://gm/SKILL.md did not answer: " + json::dump(skill).substr(0, 240));
            result.summary = "a fresh serve started from the printed entry (command and args serve, no flags) in a workspace with no harness config: initialize answers as gm, tools/list names run_code and next_context, and skill://gm/SKILL.md reads";
            session.stop();
        }
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}

#if !defined(_WIN32)
CheckResult check_serve_signal_reason(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = fs::temp_directory_path() / ("gm-serve-signal-" + std::to_string(stamp));
    const fs::path workspace = entry_workspace(sandbox);
    {
        Session session(printed_entry(binary), workspace, sandbox, kWatchdogMs);
        if (!session.started()) {
            result.failures.push_back("the printed entry did not start for the signal check");
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-11-25"}, {"capabilities", json::Object{}},
                                                   {"clientInfo", json::Object{{"name", "gm-serve-signal-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            const long long relay = session.pid();
            const std::vector<long long> workers = session.descendants();
            ::kill(static_cast<pid_t>(relay), SIGTERM);
            const auto asked = std::chrono::steady_clock::now();
            while (!alive_of({relay}).empty() && std::chrono::steady_clock::now() - asked < std::chrono::seconds(5)) std::this_thread::sleep_for(std::chrono::milliseconds(50));
            if (!alive_of({relay}).empty()) result.failures.push_back("the relay " + std::to_string(relay) + " is still alive 5 s after SIGTERM");
            while (session.stderr_text().find("gm relay: stopped by SIGTERM") == std::string::npos && std::chrono::steady_clock::now() - asked < std::chrono::seconds(8))
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
            if (session.stderr_text().find("gm relay: stopped by SIGTERM") == std::string::npos)
                result.failures.push_back("the relay did not name its stop on stderr; stderr: " + session.stderr_text().substr(0, 240));
            std::vector<long long> orphans;
            for (const long long pid : workers) {
                if (pid != relay) orphans.push_back(pid);
            }
            const auto drained = std::chrono::steady_clock::now();
            while (!alive_of(orphans).empty() && std::chrono::steady_clock::now() - drained < std::chrono::seconds(5)) std::this_thread::sleep_for(std::chrono::milliseconds(50));
            if (!alive_of(orphans).empty()) result.failures.push_back("the worker outlived the relay's SIGTERM by 5 s");
            if (stamped_stop_line(workspace, "gm relay: stopped by SIGTERM").empty())
                result.failures.push_back("the run dir's relay.log has no line \"<epoch ms> gm relay: stopped by SIGTERM\"");
            result.summary = "SIGTERM to a serve relay: the relay exits, prints gm relay: stopped by SIGTERM on stderr and as a timestamped line in the run dir's relay.log, and its worker ends with it";
            session.stop();
        }
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}
#else
CheckResult check_serve_signal_reason(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}
#endif

#if !defined(_WIN32)
namespace {

bool wait_gone(const std::vector<long long>& pids, std::chrono::seconds limit) {
    const auto began = std::chrono::steady_clock::now();
    while (!alive_of(pids).empty() && std::chrono::steady_clock::now() - began < limit) std::this_thread::sleep_for(std::chrono::milliseconds(50));
    return alive_of(pids).empty();
}

}

CheckResult check_relay_reconnects(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = fs::temp_directory_path() / ("gm-relay-reconnect-" + std::to_string(stamp));
    const fs::path workspace = entry_workspace(sandbox);
    const fs::path run = sandbox / "run";
    const std::vector<std::string> argv{fs::absolute(binary).string(), "serve", "--run-dir", run.string()};
    {
        Session first(argv, workspace, sandbox, kWatchdogMs);
        if (!first.started()) {
            result.failures.push_back("the first serve did not start");
        } else {
            first.rpc("initialize", json::Object{{"protocolVersion", "2025-11-25"}, {"capabilities", json::Object{}},
                                                 {"clientInfo", json::Object{{"name", "gm-relay-reconnect-check"}, {"version", "1"}}}});
            first.notify("notifications/initialized", json::Object{});
            const long long relay = first.pid();
            std::vector<long long> workers;
            for (const long long pid : first.descendants()) {
                if (pid != relay) workers.push_back(pid);
            }
            ::kill(static_cast<pid_t>(relay), SIGKILL);
            if (!wait_gone({relay}, std::chrono::seconds(5))) result.failures.push_back("the killed relay " + std::to_string(relay) + " is still alive after SIGKILL");
            if (!wait_gone(workers, std::chrono::seconds(8))) result.failures.push_back("the worker of the killed relay outlived it by 8 s");
            first.stop();
        }
    }
    {
        Session next(argv, workspace, sandbox, kWatchdogMs);
        if (!next.started()) {
            result.failures.push_back("a serve started after the killed relay did not start");
        } else {
            const json::Value initialized = next.rpc("initialize", json::Object{{"protocolVersion", "2025-11-25"}, {"capabilities", json::Object{}},
                                                                                {"clientInfo", json::Object{{"name", "gm-relay-reconnect-check"}, {"version", "1"}}}});
            if (text_at(initialized, "result.serverInfo.name") != "gm") result.failures.push_back("the serve started after the killed relay did not answer as gm: " + json::dump(initialized).substr(0, 240));
            next.notify("notifications/initialized", json::Object{});
            const std::vector<std::string> names = tool_names(next.rpc("tools/list", json::Object{}));
            if (!contains(names, "run_code")) result.failures.push_back("tools/list after the killed relay has no run_code");
            const json::Value skill = next.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            if (value_at(skill, "result.contents") == nullptr) result.failures.push_back("resources/read after the killed relay did not answer: " + json::dump(skill).substr(0, 240));
            next.stop();
        }
    }
    std::ifstream in(run / "relay.log");
    const std::string log((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    std::size_t starts = 0;
    for (std::size_t at = log.find("started "); at != std::string::npos; at = log.find("started ", at + 1)) ++starts;
    if (starts < 2) result.failures.push_back("relay.log in the run dir has " + std::to_string(starts) + " start line(s), expected 2: " + log.substr(0, 240));
    result.summary = "a serve started after its previous relay was SIGKILLed reconnects in the same run dir: the killed relay's worker ends with it, the next serve answers initialize as gm, lists run_code and reads the skill, and relay.log records both starts";
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}

namespace {

std::string read_whole(const fs::path& file) {
    std::ifstream in(file);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

constexpr const char* kPeerCloseScript =
    "init='{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"c\",\"version\":\"1\"}}}'\n"
    "( while [ ! -e \"$2.reader-closed\" ]; do sleep 0.05; done; printf '%s\\n' \"$init\"; i=0; while [ $i -lt 1200 ] && ! grep -q 'write to host stdout failed' \"$2/relay.log\" 2>/dev/null; do sleep 0.1; i=$((i+1)); done ) | \"$1\" serve --run-dir \"$2\" | "
    "sh -c 'exec 0<&-; : > \"$1.reader-closed\"; i=0; while [ $i -lt 1200 ] && ! grep -q \"relay exited\" \"$1/relay.log\" 2>/dev/null; do sleep 0.1; i=$((i+1)); done' sh \"$2\"\n"
    "i=0; while [ $i -lt 300 ] && ! grep -q 'relay exited' \"$2/relay.log\" 2>/dev/null; do sleep 0.1; i=$((i+1)); done\n";

}

CheckResult check_relay_disconnect_reason(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = fs::temp_directory_path() / ("gm-relay-disconnect-" + std::to_string(stamp));
    const fs::path workspace = entry_workspace(sandbox);
    const std::string gm = fs::absolute(binary).string();
    const fs::path peer_run = workspace / "runs" / "peer-close";
    fs::create_directories(peer_run.parent_path());
    const proc::Outcome peer = proc::run({"env", "HOME=" + sandbox.string(), "sh", "-c", kPeerCloseScript, "sh", gm, peer_run.string()}, workspace, {}, 240000);
    const std::string peer_log = read_whole(peer_run / "relay.log");
    if (!peer.started) result.failures.push_back("the peer-close shell did not start");
    if (peer_log.find("write to host stdout failed: ") == std::string::npos || peer_log.find("the host closed its end of stdout") == std::string::npos)
        result.failures.push_back("a host that closed the relay's stdout left no write-failure reason in relay.log: " + peer_log.substr(0, 400));
    if (peer_log.find("host closed the connection (the host closed its end of stdin (end of input") == std::string::npos)
        result.failures.push_back("the host's stdin close left no reason in relay.log: " + peer_log.substr(0, 400));
    if (peer_log.find("relay exited with code 0") == std::string::npos) result.failures.push_back("relay.log has no exit line after the peer close: " + peer_log.substr(0, 400));
    const fs::path eof_run = workspace / "runs" / "stdin-close";
    {
        Session session({gm, "serve", "--run-dir", eof_run.string()}, workspace, sandbox, kWatchdogMs);
        if (!session.started()) {
            result.failures.push_back("the stdin-close serve did not start");
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-11-25"}, {"capabilities", json::Object{}},
                                                   {"clientInfo", json::Object{{"name", "gm-relay-disconnect-check"}, {"version", "1"}}}});
            const long long relay = session.pid();
            session.close_input();
            if (!wait_gone({relay}, std::chrono::seconds(30))) result.failures.push_back("the relay outlived its stdin close by 30 s");
            session.stop();
        }
    }
    const std::string eof_log = read_whole(eof_run / "relay.log");
    if (eof_log.find("host closed the connection (the host closed its end of stdin (end of input") == std::string::npos || eof_log.find("relay exited with code 0") == std::string::npos)
        result.failures.push_back("a stdin close left no reason or exit line in relay.log: " + eof_log.substr(0, 400));
    const fs::path signal_run = workspace / "runs" / "signal";
    {
        Session session({gm, "serve", "--run-dir", signal_run.string()}, workspace, sandbox, kWatchdogMs);
        if (!session.started()) {
            result.failures.push_back("the signal serve did not start");
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-11-25"}, {"capabilities", json::Object{}},
                                                   {"clientInfo", json::Object{{"name", "gm-relay-disconnect-check"}, {"version", "1"}}}});
            const long long relay = session.pid();
            ::kill(static_cast<pid_t>(relay), SIGUSR1);
            if (!wait_gone({relay}, std::chrono::seconds(10))) result.failures.push_back("the relay outlived SIGUSR1 by 10 s");
            session.stop();
        }
    }
    if (stamped_stop_line(workspace, "gm relay: stopped by SIGUSR1").empty())
        result.failures.push_back("SIGUSR1 left no stamped stop line in relay.log: " + read_whole(signal_run / "relay.log").substr(0, 400));
    result.summary = "relay.log names each forced disconnect: a host that closed the relay's stdout (write to host stdout failed), a host that closed stdin (host closed the connection, end of input, then relay exited with code 0), and SIGUSR1 (a stamped stopped by SIGUSR1 line)";
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}
#else
CheckResult check_relay_disconnect_reason(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, it uses signals and a shell pipeline";
    return result;
}

CheckResult check_relay_reconnects(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}
#endif

}
