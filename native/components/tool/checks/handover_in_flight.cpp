#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <optional>
#include <string>
#include <system_error>
#include <thread>

#if defined(__linux__)
#include <sys/stat.h>
#endif

namespace gm::tool {
namespace {

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;

constexpr const char* kOffered = "ffff222-99";
constexpr long long kDownloadWaitMs = 20000;
constexpr long long kReexecLimitMs = 10000;
constexpr long long kWorkerLimitMs = 15000;
constexpr long long kGoneLimitMs = 10000;
constexpr const char* kReexecMarker = "re-executing the relay";
constexpr const char* kPointedMarker = "the install now points at";

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

bool ends_with(const std::string& text, const std::string& tail) {
    return text.size() >= tail.size() && text.compare(text.size() - tail.size(), tail.size(), tail) == 0;
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

}

CheckResult check_handover_in_flight(const std::string& binary) {
    CheckResult result;
#if !defined(__linux__)
    result.summary = "skipped (the check stages a fifo archive and watches /proc, which this platform lacks)";
    return result;
#else
    const auto started = Clock::now();
    const fs::path host = fs::path(binary).parent_path();
    const auto version_run = proc::run({binary, "--version"}, {}, {}, 30000);
    const std::string stamp_line = version_run.out;
    const std::string stamp = first_word(stamp_line);
    if (stamp.empty()) {
        result.failures.push_back("the build reports no stamp: " + stamp_line);
        return result;
    }
    if (stamp == "dev" || ends_with(stamp, "-dev")) {
        result.summary = "skipped (" + stamp + ": a development build never updates itself, so its relay never downloads; run this on a build configured with -DGMNEW_VERSION=<commit>-1)";
        return result;
    }
    const fs::path repo = checkout_root();
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const std::string second = std::string(1, stamp[0] == '0' ? '1' : '0') + stamp.substr(1);
    const fs::path scratch = fs::temp_directory_path() / ("gm-handover-flight-" + std::to_string(started.time_since_epoch().count()));
    const std::string archive_name = std::string("gmnew-") + kPlatformTarget + ".tar.gz";
    const fs::path published = scratch / "published";
    const fs::path archive = published / archive_name;
    const fs::path install = scratch / "install";
    const fs::path versions = install / "versions";
    const fs::path home = scratch / "home";
    const fs::path workspace = scratch / "ws";
    const fs::path quiet = scratch / "quiet.json";
    std::error_code ec;
    fs::create_directories(published, ec);
    fs::create_directories(home, ec);
    fs::create_directories(workspace, ec);
    std::string error;
    if (!stage_build(versions / stamp, host, repo, stamp, stamp, error) || !stage_build(versions / second, host, repo, stamp, second, error)) {
        result.failures.push_back(error.empty() ? std::string("could not stage the builds") : error);
        fs::remove_all(scratch, ec);
        return result;
    }
    fs::create_directory_symlink(fs::path("versions") / stamp, install / "current", ec);
    if (::mkfifo(archive.c_str(), 0600) != 0) {
        result.failures.push_back("could not make the archive fifo " + archive.string());
        fs::remove_all(scratch, ec);
        return result;
    }
    json::Value manifest = json::Object{
        {"version", kOffered},
        {"commit", "ffff222" + std::string(33, 'b')},
        {"built", "2026-11-12T00:00:00Z"},
        {"repo", "AnEntrypoint/gm"},
        {"assets", json::Object{{kPlatformTarget, json::Object{{"file", archive_name}, {"sha256", std::string(64, '0')}, {"size", static_cast<std::uint64_t>(1)}, {"version", kOffered}}}}}};
    std::ofstream(published / "manifest.json") << json::dump(manifest);
    std::ofstream(quiet) << R"({"mcpServers":{"playwriter":{"disabled":true}}})";

    const std::string manifest_url = "file://" + (published / "manifest.json").string();
    std::optional<long long> pointed_to_reexec;
    std::optional<long long> pointed_to_worker;
    std::optional<long long> pointed_to_gone;
    std::vector<long long> download;
    {
        Session session(std::vector<std::string>{"env", "-u", "GMNEW_AUTO_UPDATE", "GMNEW_UPDATE_URL=" + manifest_url, (install / "current" / "gm").string(), "serve",
                                                 "--workspace", workspace.string(), "--run-dir", (workspace / "run").string(), "--mcp-config", quiet.string()},
                        workspace, home, 240000);
        if (!session.started()) {
            result.failures.push_back("the relay did not start from " + (install / "current" / "gm").string());
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "handover-in-flight-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});

            const auto download_deadline = Clock::now() + std::chrono::milliseconds(kDownloadWaitMs);
            while (download.empty() && Clock::now() < download_deadline) {
                download = processes_mentioning(archive.string());
                if (download.empty()) std::this_thread::sleep_for(std::chrono::milliseconds(50));
            }
            if (download.empty()) {
                result.failures.push_back("the update never started a download of " + archive.string() + ": " + session.stderr_text().substr(0, 300));
            } else {
                const auto pointed_at = Clock::now();
                point(install, second);
                const auto reexec_deadline = pointed_at + std::chrono::milliseconds(kReexecLimitMs);
                while (!session.stderr_text().contains(kReexecMarker) && Clock::now() < reexec_deadline) std::this_thread::sleep_for(std::chrono::milliseconds(50));
                if (session.stderr_text().contains(kReexecMarker)) pointed_to_reexec = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - pointed_at).count();
                else result.failures.push_back("the relay did not re-execute while the download was in flight: " + session.stderr_text().substr(0, 300));

                const auto worker_deadline = pointed_at + std::chrono::milliseconds(kWorkerLimitMs);
                bool on_second = false;
                while (!on_second && Clock::now() < worker_deadline) {
                    for (long long child : children_of(session.pid())) {
                        if (proc::process_exe(child).string().find("versions/" + second + "/gm-core") != std::string::npos) on_second = true;
                    }
                    if (!on_second) std::this_thread::sleep_for(std::chrono::milliseconds(50));
                }
                if (on_second) pointed_to_worker = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - pointed_at).count();
                else result.failures.push_back("the worker does not run " + second + " after the install pointer moved");

                const auto gone_deadline = pointed_at + std::chrono::milliseconds(kGoneLimitMs);
                while (!alive_of(download).empty() && Clock::now() < gone_deadline) std::this_thread::sleep_for(std::chrono::milliseconds(50));
                if (alive_of(download).empty()) pointed_to_gone = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - pointed_at).count();
                else result.failures.push_back("the download of " + archive.string() + " survived the re-execute: pids " + std::to_string(alive_of(download).front()));

                const std::string stderr_now = session.stderr_text();
                if (stderr_now.find("gm relay: updated ") != std::string::npos) result.failures.push_back("the update completed, so the handover did not wait on a download in flight: " + stderr_now.substr(0, 300));
                if (!stderr_now.contains(kPointedMarker)) result.failures.push_back("the relay did not name the pointed build");

                const json::Value after = tool_json(session, "next_context", json::Object{});
                const json::Value* ok = after.find("ok");
                if (ok == nullptr || !ok->is_bool() || !ok->as_bool()) result.failures.push_back("next_context on the relay that re-executed did not answer ok: " + json::dump(after).substr(0, 300));
            }
        }
        session.stop();
    }
    kill_processes(processes_mentioning(scratch.string()));
    fs::remove_all(scratch, ec);
    const double wall = std::chrono::duration<double>(Clock::now() - started).count();
    if (result.failures.empty()) {
        result.summary = stamp + " -> " + second + ": the install pointer moved while a download of " + archive_name + " was in flight: the relay re-executed " +
                         std::to_string(pointed_to_reexec.value_or(-1)) + " ms after the change, the worker ran " + second + " at " + std::to_string(pointed_to_worker.value_or(-1)) +
                         " ms, the cancelled download was gone at " + std::to_string(pointed_to_gone.value_or(-1)) + " ms, and next_context answered ok (wall " + std::to_string(wall) + " s)";
    }
    return result;
#endif
}

}
