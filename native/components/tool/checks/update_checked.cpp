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

std::string first_word_of(const std::string& text) {
    std::istringstream in(text);
    std::string word;
    in >> word;
    return word;
}

std::string read_text(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::stringstream text;
    text << in.rdbuf();
    return text.str();
}

fs::path checkout_root() {
    std::error_code ec;
    for (fs::path dir = fs::current_path(ec); !dir.empty(); dir = dir.parent_path()) {
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) break;
    }
    return {};
}

}

CheckResult check_update_checked(const std::string& binary) {
    CheckResult result;
    const auto version_run = proc::run({binary, "--version"}, {}, {}, 30000);
    const std::string version = first_word_of(version_run.out);
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
    const std::string head = first_word_of(head_run.out);
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
    fs::create_directories(published, ec);
    fs::create_directories(install, ec);
    fs::create_directories(home, ec);
    fs::create_directories(workspace, ec);
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
    std::string log;
    bool seen = false;
    {
        Session session(std::vector<std::string>{"env", "-u", "GMNEW_AUTO_UPDATE", "GMNEW_UPDATE_URL=" + manifest_url, (install / "gm").string(), "serve",
                                                 "--workspace", workspace.string(), "--run-dir", (workspace / "run").string(), "--mcp-config", quiet.string()},
                        workspace, home, 120000);
        if (!session.started()) {
            result.failures.push_back("the installed gm did not start from " + (install / "gm").string());
        } else {
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
            while (!seen && std::chrono::steady_clock::now() < deadline) {
                log = read_text(workspace / "run" / "relay.log");
                seen = log.find(expected) != std::string::npos;
                if (!seen) std::this_thread::sleep_for(std::chrono::milliseconds(500));
            }
        }
    }
    fs::remove_all(scratch, ec);
    if (!seen && result.failures.empty()) {
        result.failures.push_back("no relay.log line \"" + expected + "\" within 60 s; the relay log says: " + log.substr(log.size() > 400 ? log.size() - 400 : 0));
    }
    if (result.failures.empty()) result.summary = "a relay with an already-current manifest logs each update cycle as \"" + expected + "\" in its relay.log";
    return result;
}

}
