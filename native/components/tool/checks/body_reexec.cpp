#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <optional>
#include <string>
#include <system_error>
#include <thread>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;

constexpr long long kBodySeconds = 5;
constexpr long long kWaitMarkerLimitMs = 6000;
constexpr long long kHoldMs = 1000;
constexpr long long kAnswerLimitMs = 40000;
constexpr long long kReexecLimitMs = 20000;
constexpr long long kWorkerLimitMs = 15000;
constexpr const char* kReexecMarker = "re-executing the relay on the new build";
constexpr const char* kWaitMarker = "re-executing waits for 1 running body job";

#if defined(__aarch64__)
constexpr const char* kPlatformTarget = "arm64-linux";
#else
constexpr const char* kPlatformTarget = "x64-linux";
#endif

std::string first_word(const std::string& text) {
    const auto start = text.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return {};
    const auto end = text.find_first_of(" \t\r\n", start);
    return text.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

fs::path checkout_root() {
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) return {};
    }
}

std::string read_bytes(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

std::string replace_all(std::string text, const std::string& from, const std::string& to) {
    for (std::size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size())) text.replace(at, from.size(), to);
    return text;
}

void make_executable(const fs::path& file) {
    std::error_code ec;
    fs::permissions(file, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace, ec);
}

bool stage_build(const fs::path& dir, const fs::path& host, const fs::path& repo, const std::string& from, const std::string& to, std::string& error) {
    std::error_code ec;
    fs::create_directories(dir, ec);
    for (const char* name : {"gm", "gm-core"}) {
        std::ofstream out(dir / name, std::ios::binary);
        out << replace_all(read_bytes(host / name), from, to);
        out.close();
        make_executable(dir / name);
    }
    const std::vector<std::pair<std::string, fs::path>> shared{
        {"leaves", repo / "native" / "leaves"}, {"skills", repo / "skills"}, {"defaults", repo / "defaults"}};
    for (const auto& [name, from_checkout] : shared) {
        std::error_code exists_ec;
        const fs::path source = fs::exists(host / name, exists_ec) ? host / name : from_checkout;
        fs::copy(source, dir / name, fs::copy_options::recursive | fs::copy_options::overwrite_existing, ec);
        if (ec) {
            error = "could not stage " + name + ": " + ec.message();
            return false;
        }
    }
    return true;
}

void point(const fs::path& install, const std::string& version) {
    const fs::path link = install / "current.tmp";
    std::error_code ec;
    fs::remove(link, ec);
    fs::create_directory_symlink(fs::path("versions") / version, link, ec);
    fs::rename(link, install / "current", ec);
}

std::vector<long long> children_of(long long pid) {
    std::vector<long long> found;
    for (long long child : process_tree({pid})) {
        if (child != pid) found.push_back(child);
    }
    return found;
}

long long worker_under(long long relay, const std::string& version) {
    for (long long child : children_of(relay)) {
        if (proc::process_exe(child).string().find("versions/" + version + "/gm-core") != std::string::npos) return child;
    }
    return 0;
}

long long ms_since(Clock::time_point at) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - at).count();
}

}

CheckResult check_body_reexec(const std::string& binary) {
    CheckResult result;
#if !defined(__linux__)
    result.summary = "skipped (not on this platform: the check watches /proc for the worker, which this platform lacks)";
    return result;
#else
    const auto started = Clock::now();
    const fs::path host = fs::path(binary).parent_path();
    const std::string stamp = first_word(proc::run({binary, "--version"}, {}, {}, 30000).out);
    if (stamp.empty()) {
        result.failures.push_back("the build reports no stamp");
        return result;
    }
    const fs::path repo = checkout_root();
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const std::string second = std::string(1, stamp[0] == '0' ? '1' : '0') + stamp.substr(1);
    const fs::path scratch = fs::temp_directory_path() / ("gm-body-reexec-" + std::to_string(started.time_since_epoch().count()));
    const fs::path install = scratch / "install";
    const fs::path versions = install / "versions";
    const fs::path home = scratch / "home";
    const fs::path workspace = scratch / "ws";
    const fs::path quiet = scratch / "quiet.json";
    std::error_code ec;
    fs::create_directories(home, ec);
    fs::create_directories(workspace, ec);
    std::string error;
    if (!stage_build(versions / stamp, host, repo, stamp, stamp, error) || !stage_build(versions / second, host, repo, stamp, second, error)) {
        result.failures.push_back(error.empty() ? std::string("could not stage the builds") : error);
        fs::remove_all(scratch, ec);
        return result;
    }
    fs::create_directory_symlink(fs::path("versions") / stamp, install / "current", ec);
    std::ofstream(quiet) << R"({"mcpServers":{"playwriter":{"disabled":true}}})";

    const std::string body_source =
        "const began = Date.now(); await gm.run_shell({ command: 'sleep " + std::to_string(kBodySeconds) +
        "' }); return { began, ended: Date.now() };";
    std::string job;
    std::optional<long long> worker;
    long long answered_ms = -1;
    long long reexec_ms = -1;
    long long worker_ms = -1;
    {
        Session session(std::vector<std::string>{"env", "GMNEW_AUTO_UPDATE=0", (install / "current" / "gm").string(), "serve", "--workspace",
                                                 workspace.string(), "--run-dir", (workspace / "run").string(), "--mcp-config", quiet.string()},
                        workspace, home, 240000);
        if (!session.started()) {
            result.failures.push_back("the relay did not start from " + (install / "current" / "gm").string());
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-body-reexec"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});

            const json::Value started_body = tool_json(session, "run_code", json::Object{{"body", body_source}, {"timeoutMs", 1000}});
            const json::Value* background = started_body.find("background");
            if (background == nullptr || !background->is_string()) {
                result.failures.push_back("the body did not start as a background run: " + json::dump(started_body).substr(0, 240));
            } else {
                job = background->as_string();
                for (long long pid : children_of(session.pid())) {
                    if (proc::process_exe(pid).string().find("gm-core") != std::string::npos) worker = pid;
                }
                if (!worker) result.failures.push_back("no worker runs under the relay before the install pointer moves");
            }

            if (worker && !job.empty()) {
                const auto pointed_at = Clock::now();
                point(install, second);

                const auto wait_deadline = Clock::now() + std::chrono::milliseconds(kWaitMarkerLimitMs);
                while (!session.stderr_text().contains(kWaitMarker) && Clock::now() < wait_deadline) std::this_thread::sleep_for(std::chrono::milliseconds(50));
                if (!session.stderr_text().contains(kWaitMarker)) result.failures.push_back("the relay did not report that the re-execute waits for the running body: " + session.stderr_text().substr(0, 300));

                const auto hold_until = Clock::now() + std::chrono::milliseconds(kHoldMs);
                while (Clock::now() < hold_until) std::this_thread::sleep_for(std::chrono::milliseconds(50));
                if (session.stderr_text().contains(kReexecMarker)) result.failures.push_back("the relay re-executed while the body was still running");
                if (alive_of({*worker}).empty()) result.failures.push_back("the worker " + std::to_string(*worker) + " ended while the body ran");

                const std::string fetch_source =
                    "const ended = await gm.job_status({ job: '" + job + "', waitMs: 60000 }); return { state: ended.state, value: ended.value || ended.output };";
                const json::Value answer = output_value(tool_json(session, "run_code", json::Object{{"body", fetch_source}, {"timeoutMs", static_cast<std::int64_t>(kAnswerLimitMs)}}));
                answered_ms = ms_since(pointed_at);
                const json::Value* state_value = answer.find("state");
                const json::Value* value_text = answer.find("value");
                const bool exited = state_value != nullptr && state_value->is_string() && state_value->as_string() == "exited";
                const bool valued = value_text != nullptr && value_text->is_string() && value_text->as_string().find("ended") != std::string::npos;
                if (!exited || !valued) result.failures.push_back("the body did not finish with its value: " + json::dump(answer).substr(0, 300));

                const auto reexec_deadline = Clock::now() + std::chrono::milliseconds(kReexecLimitMs);
                while (!session.stderr_text().contains(kReexecMarker) && Clock::now() < reexec_deadline) std::this_thread::sleep_for(std::chrono::milliseconds(50));
                if (session.stderr_text().contains(kReexecMarker)) reexec_ms = ms_since(pointed_at);
                else result.failures.push_back("the relay did not re-execute after the body ended: " + session.stderr_text().substr(0, 300));

                const auto worker_deadline = pointed_at + std::chrono::milliseconds(kWorkerLimitMs);
                long long on_second = 0;
                while (on_second == 0 && Clock::now() < worker_deadline) {
                    on_second = worker_under(session.pid(), second);
                    if (on_second == 0) std::this_thread::sleep_for(std::chrono::milliseconds(50));
                }
                if (on_second != 0) worker_ms = ms_since(pointed_at);
                else result.failures.push_back("the worker does not run " + second + " after the body ended");
            }
        }
        session.stop();
    }
    kill_processes(processes_mentioning(scratch.string()));
    fs::remove_all(scratch, ec);
    const double wall = std::chrono::duration<double>(Clock::now() - started).count();
    if (result.failures.empty()) {
        result.summary = stamp + " -> " + second + ": a body job that ran " + std::to_string(kBodySeconds) +
                         " s kept its worker across the install pointer change: the relay waited for it, the job answered with its value at " +
                         std::to_string(answered_ms) + " ms, the relay re-executed at " + std::to_string(reexec_ms) + " ms and the worker ran " + second + " at " +
                         std::to_string(worker_ms) + " ms (wall " + std::to_string(wall) + " s)";
    }
    return result;
#endif
}

}
