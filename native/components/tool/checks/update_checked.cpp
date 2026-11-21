#include "gm/proc.hpp"
#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>
#include <thread>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

}

CheckResult check_update_checked(const std::string& binary) {
    CheckResult result;
    const auto version_run = proc::run({binary, "--version"}, {}, {}, 30000);
    const std::string version = first_word(version_run.out);
    if (version.empty()) {
        result.failures.push_back("the build prints no version: " + version_run.out.substr(0, 200));
        return result;
    }
    if (version == "dev" || version.ends_with("-dev")) {
        result.summary = "skipped (" + version + ": a development build never updates itself, so its relay never runs an update cycle; run this on a build configured with -DGMNEW_VERSION=<commit>-1)";
        return result;
    }
    const fs::path repo = checkout_root();
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const auto head_run = proc::run({"git", "rev-parse", "HEAD"}, repo, {}, 30000);
    const std::string head = first_word(head_run.out);
    if (head.size() != 40) {
        result.failures.push_back("could not read HEAD of the checkout: " + head_run.err.substr(0, 200));
        return result;
    }

    const fs::path host = fs::path(binary).parent_path();
    const auto started = std::chrono::steady_clock::now();
    const fs::path scratch = fs::temp_directory_path() / ("gm-update-checked-" + std::to_string(started.time_since_epoch().count()));
    const fs::path published = scratch / "published";
    const fs::path install = scratch / "install";
    const fs::path home = scratch / "home";
    const fs::path workspace = scratch / "ws";
    const std::string offered = "ffff444-5";
    std::error_code ec;
    for (const fs::path& dir : {published, install, home, workspace}) fs::create_directories(dir, ec);
    if (const std::string error = support::stage_install(host, repo, install); !error.empty()) {
        result.failures.push_back(error);
        fs::remove_all(scratch, ec);
        return result;
    }
    const json::Value manifest = json::Object{
        {"version", offered},
        {"commit", head},
        {"built", "2026-11-19T00:00:00Z"},
        {"repo", "AnEntrypoint/gm"},
        {"assets", json::Object{}}};
    std::ofstream(published / "manifest.json") << json::dump(manifest);
    const fs::path quiet = scratch / "quiet-mcp.json";
    std::ofstream(quiet) << R"({"mcpServers":{"playwriter":{"disabled":true}}})";

    const std::string manifest_url = "file://" + (published / "manifest.json").string();
    const std::string expected = "update checked: current is " + version + ", manifest is " + offered;
    const auto cycle = [&](const fs::path& run_dir) {
        std::string log;
        Session session(std::vector<std::string>{"env", "-u", "GMNEW_AUTO_UPDATE", "GMNEW_UPDATE_URL=" + manifest_url, (install / "gm").string(), "serve",
                                                 "--workspace", workspace.string(), "--run-dir", run_dir.string(), "--mcp-config", quiet.string()},
                        workspace, home, 120000);
        if (!session.started()) {
            result.failures.push_back("the installed gm did not start from " + (install / "gm").string());
            return log;
        }
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
        while (log.find(expected) == std::string::npos && std::chrono::steady_clock::now() < deadline) {
            log = support::read_text(run_dir / "relay.log");
            if (log.find(expected) == std::string::npos) std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }
        return log;
    };
    const auto tail_of = [](const std::string& log) { return log.substr(log.size() > 400 ? log.size() - 400 : 0); };
    const std::string first = cycle(scratch / "run");
    if (result.failures.empty() && first.find(expected) == std::string::npos) {
        result.failures.push_back("no relay.log line \"" + expected + "\" within 60 s; the relay log says: " + tail_of(first));
    }
    if (result.failures.empty()) {
        const std::string second = cycle(scratch / "run-again");
        if (second.find(expected) == std::string::npos) {
            result.failures.push_back("a second relay on the same install, whose cycle is within the check interval, did not log \"" + expected + "\"; its relay log says: " + tail_of(second));
        }
    }
    if (result.failures.empty()) {
        const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        std::ofstream(install / ".gmnew-update.json") << "{\"checked_ms\":" << now_ms << ",\"etag\":\"\\\"seen\\\"\",\"version\":\"" << version << "\"}";
        const std::string third = cycle(scratch / "run-fresh");
        if (third.find(expected) == std::string::npos) {
            result.failures.push_back("a relay on an install whose state has a recent check and an etag but no manifest version did not log \"" + expected + "\"; its relay log says: " + tail_of(third));
        }
    }
    fs::remove_all(scratch, ec);
    if (result.failures.empty()) {
        result.summary = "a relay with an already-current manifest logs each update cycle as \"" + expected + "\" in its relay.log, and a cycle inside the check interval, or on an install that has not recorded a manifest, logs the same manifest version";
    }
    return result;
}

}
