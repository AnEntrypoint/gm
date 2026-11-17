#include "gm/tool.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <thread>

namespace gm::tool {

#if defined(_WIN32)
namespace {

namespace fs = std::filesystem;

fs::path windows_sandbox(const std::string& prefix) {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / (prefix + std::to_string(stamp));
    fs::create_directories(sandbox / "ws" / ".gm");
    std::ofstream(sandbox / "ws" / ".gm" / "mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    return sandbox;
}

void open_session(Session& session, const std::string& client) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", client}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
}

json::Value shell_body(Session& session, const std::string& command, int timeout_ms) {
    const std::string body = "const r = await gm.run_shell({ command: " + json::dump(json::Value(command)) + ", timeoutMs: " + std::to_string(timeout_ms) +
                             " }); return { output: r.output, timedOut: r.timedOut === true, exitCode: r.exitCode };";
    return output_value(tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 60000}, {"body", body}}));
}

bool image_running(const std::string& image) {
    const proc::Outcome listed = proc::run({"tasklist", "/FI", "IMAGENAME eq " + image, "/NH"}, {}, {}, 30000);
    return listed.out.find(image) != std::string::npos;
}

bool image_gone(const std::string& image, std::chrono::seconds limit) {
    const auto began = std::chrono::steady_clock::now();
    while (image_running(image) && std::chrono::steady_clock::now() - began < limit) std::this_thread::sleep_for(std::chrono::milliseconds(250));
    return !image_running(image);
}

void stop_image(const std::string& image) { proc::run({"taskkill", "/F", "/IM", image}, {}, {}, 30000); }

}

CheckResult check_windows_tree_kill(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = windows_sandbox("gm-win-tree-");
    const char* system_root = std::getenv("SystemRoot");
    const fs::path ping = fs::path(system_root != nullptr ? system_root : "C:\\Windows") / "System32" / "PING.EXE";
    const std::string image = "gmreap" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count() % 1000000000) + ".exe";
    const fs::path exe = sandbox / image;
    std::error_code ec;
    fs::copy_file(ping, exe, fs::copy_options::overwrite_existing, ec);
    if (ec) {
        result.failures.push_back("cannot copy " + ping.string() + ": " + ec.message());
        fs::remove_all(sandbox, ec);
        return result;
    }
    const std::string quoted = "\"" + exe.string() + "\"";
    {
        Session session(binary, sandbox / "ws", sandbox, 180000, true, {}, {{"USERPROFILE", sandbox.string()}});
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            open_session(session, "witness-windows-tree-kill");
            const json::Value control = shell_body(session, quoted + " -n 1 127.0.0.1", 20000);
            const json::Value* control_exit = control.find("exitCode");
            const json::Value* control_timed_out = control.find("timedOut");
            if (control_exit == nullptr || !control_exit->is_number() || control_exit->as_number() != 0 || control_timed_out == nullptr || !control_timed_out->is_bool() || control_timed_out->as_bool())
                result.failures.push_back("the copied ping did not exit 0 in the foreground: " + json::dump(control).substr(0, 240));
            const json::Value exited = shell_body(session, "start /b \"\" " + quoted + " -n 60 127.0.0.1 >nul", 20000);
            if (!image_gone(image, std::chrono::seconds(10))) {
                result.failures.push_back("a child started with start /b outlived its run_shell's exit by 10 s: " + json::dump(exited).substr(0, 200));
                stop_image(image);
            }
            const json::Value timed = shell_body(session, "start /b \"\" " + quoted + " -n 60 127.0.0.1 >nul & " + quoted + " -n 60 127.0.0.1 >nul", 3000);
            const json::Value* flag = timed.find("timedOut");
            if (flag == nullptr || !flag->is_bool() || !flag->as_bool()) result.failures.push_back("the 3000 ms run_shell did not time out: " + json::dump(timed).substr(0, 200));
            if (!image_gone(image, std::chrono::seconds(10))) {
                result.failures.push_back("a child of a timed-out run_shell outlived the timeout by 10 s");
                stop_image(image);
            }
            session.stop();
        }
    }
    result.summary = "run_shell on Windows puts its shell in a job object: a child started with start /b is ended when the shell exits, and every child of a timed-out shell is ended with it";
    fs::remove_all(sandbox, ec);
    return result;
}

CheckResult check_windows_playwriter(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = windows_sandbox("gm-win-playwriter-");
    const fs::path bin = sandbox / ".gmnew" / "pw" / "bin";
    const fs::path package = sandbox / ".gmnew" / "pw" / "node_modules" / "playwriter";
    fs::create_directories(bin);
    fs::create_directories(package);
    std::ofstream(package / "bin.js") << "console.log('gm-witness-playwriter ' + process.argv.slice(2).join(' '));\n";
    {
        Session session(binary, sandbox / "ws", sandbox, 180000, true, {}, {{"USERPROFILE", sandbox.string()}});
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            open_session(session, "witness-windows-playwriter");
            std::error_code ec;
            if (!fs::exists(bin / "playwriter.cmd", ec) || !fs::exists(bin / "playwriter", ec))
                result.failures.push_back("the fresh gm serve did not write playwriter.cmd and playwriter in " + bin.string());
            const json::Value through_shell = shell_body(session, "playwriter witness", 30000);
            if (text_at(through_shell, "output").find("gm-witness-playwriter witness") == std::string::npos)
                result.failures.push_back("playwriter by name in the default run_shell printed " + json::dump(through_shell).substr(0, 300));
            const json::Value through_cmd = shell_body(session, "set GM_WITNESS=1 & playwriter witness-cmd", 30000);
            if (text_at(through_cmd, "output").find("gm-witness-playwriter witness-cmd") == std::string::npos)
                result.failures.push_back("playwriter by name in a cmd.exe run_shell printed " + json::dump(through_cmd).substr(0, 300));
            session.stop();
        }
    }
    result.summary = "a fresh gm serve on Windows writes pw\\bin\\playwriter.cmd and pw\\bin\\playwriter for an install with the package, puts pw\\bin first on PATH, and playwriter runs by name from the default shell and from cmd.exe";
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}
#else
CheckResult check_windows_tree_kill(const std::string&) {
    CheckResult result;
    result.summary = "skipped: the job-object tree-kill witness runs on Windows only";
    return result;
}

CheckResult check_windows_playwriter(const std::string&) {
    CheckResult result;
    result.summary = "skipped: the playwriter shim witness runs on Windows only";
    return result;
}
#endif

}
