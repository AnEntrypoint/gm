#include "support.hpp"

#include "gm/proc.hpp"
#include "gm/tool.hpp"

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

proc::Outcome git_at(const fs::path& dir, const std::vector<std::string>& args) {
    std::vector<std::string> argv = {"git", "-C", dir.string(), "-c", "user.name=gm", "-c", "user.email=gm@invalid", "-c", "commit.gpgsign=false"};
    argv.insert(argv.end(), args.begin(), args.end());
    return proc::run(argv, {}, {}, 60000);
}

struct Scratch {
    fs::path path;
    ~Scratch() {
        std::error_code ec;
        fs::remove_all(path, ec);
    }
};

}

CheckResult check_update_checkout(const std::string& binary) {
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
    const auto head_run = proc::run({"git", "-C", repo.string(), "rev-parse", "HEAD"}, {}, {}, 30000);
    const std::string head = first_word(head_run.out);
    if (head.size() != 40) {
        result.failures.push_back("could not read HEAD of the checkout: " + head_run.err.substr(0, 200));
        return result;
    }

    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-update-checkout-" + std::to_string(stamp));
    std::error_code ec;
    fs::create_directories(scratch, ec);
    const Scratch guard{scratch};
    const fs::path origin = scratch / "origin.git";
    const fs::path checkout = scratch / "checkout";
    const fs::path other = scratch / "other";
    const fs::path install = scratch / "install";
    const fs::path home = scratch / "home";
    const fs::path run_dir = scratch / "run";
    const fs::path published = scratch / "published";
    for (const fs::path& dir : {home, run_dir, published}) fs::create_directories(dir, ec);
    const fs::path quiet = scratch / "quiet.json";
    std::ofstream(quiet) << R"({"mcpServers":{"playwriter":{"disabled":true}}})";

    const auto run_git = [&](const fs::path& dir, const std::vector<std::string>& args, const std::string& what) {
        const proc::Outcome outcome = git_at(dir, args);
        if (!outcome.started || outcome.exit_code != 0) result.failures.push_back(what + ": " + outcome.err.substr(0, 200));
        return outcome;
    };
    run_git(scratch, {"init", "-q", "--bare", origin.string()}, "could not create the origin");
    run_git(origin, {"symbolic-ref", "HEAD", "refs/heads/main"}, "could not name the origin's branch");
    run_git(scratch, {"init", "-q", checkout.string()}, "could not create the checkout");
    run_git(checkout, {"symbolic-ref", "HEAD", "refs/heads/main"}, "could not name the checkout's branch");
    run_git(checkout, {"commit", "-q", "--allow-empty", "-m", "base"}, "could not commit the base");
    run_git(checkout, {"remote", "add", "origin", origin.string()}, "could not add the origin");
    run_git(checkout, {"push", "-q", "origin", "main"}, "could not push the base");
    run_git(checkout, {"fetch", "-q", "origin"}, "could not fetch the base");
    run_git(scratch, {"clone", "-q", origin.string(), other.string()}, "could not clone the origin");
    run_git(other, {"commit", "-q", "--allow-empty", "-m", "ahead"}, "could not commit ahead");
    run_git(other, {"push", "-q", "origin", "HEAD:main"}, "could not push ahead");
    if (!result.failures.empty()) return result;

    const std::string tracked = first_word(run_git(checkout, {"rev-parse", "refs/remotes/origin/main"}, "could not read the tracking ref").out);
    const std::string remote = first_word(run_git(checkout, {"ls-remote", "origin", "refs/heads/main"}, "could not read the origin").out);
    if (remote.empty() || remote == tracked) {
        result.failures.push_back("setup: origin main is not ahead of the checkout's origin/main, so a fetch would change nothing");
        return result;
    }

    const auto snapshot = [&] {
        return run_git(checkout, {"for-each-ref", "--format=%(refname) %(objectname)"}, "could not list the checkout's refs").out +
               "FETCH_HEAD " + support::file_sha256(checkout / ".git" / "FETCH_HEAD");
    };
    const std::string before = snapshot();

    const std::string offered = "ffff444-5";
    const json::Value manifest = json::Object{
        {"version", offered},
        {"commit", head},
        {"built", "2026-11-19T00:00:00Z"},
        {"repo", "AnEntrypoint/gm"},
        {"assets", json::Object{}}};
    std::ofstream(published / "manifest.json") << json::dump(manifest);

    const fs::path host = fs::path(binary).parent_path();
    if (const std::string error = support::stage_install(host, repo, install); !error.empty()) {
        result.failures.push_back(error);
        return result;
    }

    const std::string manifest_url = "file://" + (published / "manifest.json").string();
    const std::string expected = "update checked: current is " + version + ", manifest is " + offered;
    std::string log;
    bool seen = false;
    {
        Session session(std::vector<std::string>{"env", "-u", "GMNEW_AUTO_UPDATE", "GMNEW_UPDATE_URL=" + manifest_url, (install / "gm").string(), "serve",
                                                 "--workspace", checkout.string(), "--run-dir", run_dir.string(), "--mcp-config", quiet.string()},
                        checkout, home, 120000);
        if (!session.started()) {
            result.failures.push_back("the installed gm did not start from " + (install / "gm").string());
        } else {
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
            while (!seen && std::chrono::steady_clock::now() < deadline) {
                log = support::read_text(run_dir / "relay.log");
                seen = log.find(expected) != std::string::npos;
                if (!seen) std::this_thread::sleep_for(std::chrono::milliseconds(500));
            }
        }
    }
    if (!seen && result.failures.empty()) {
        result.failures.push_back("no update cycle logged \"" + expected + "\" within 60 s; the relay log says: " + log.substr(log.size() > 400 ? log.size() - 400 : 0));
    }
    const std::string after = snapshot();
    if (before != after) {
        result.failures.push_back("an update cycle changed the checkout's refs or FETCH_HEAD: before [" + before + "] after [" + after + "]");
    }
    if (result.failures.empty()) {
        result.summary = "a relay whose workspace is a git checkout ran an update cycle and left the checkout's refs and FETCH_HEAD byte-identical, with origin one commit ahead of its origin/main";
    }
    return result;
}

}
