#include "gm/tool.hpp"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <system_error>
#include <thread>

#if defined(_WIN32)
#include <process.h>
#define GM_PID _getpid()
#else
#include <unistd.h>
#define GM_PID ::getpid()
#endif

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

constexpr int kDefaultCiWaitMinutes = 120;

proc::Outcome run_in(const fs::path& dir, const std::vector<std::string>& argv, std::uint64_t timeout_ms = 0) {
    return proc::run(argv, dir, {}, timeout_ms);
}

bool succeeded(const proc::Outcome& outcome) { return outcome.started && outcome.exit_code == 0; }

std::string trim_line(std::string text) {
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

std::string git_line(const fs::path& root, const std::vector<std::string>& args) { return trim_line(git_output(root, args).value_or("")); }

bool origin_main_contains_head(const fs::path& root) {
    if (!git_output(root, {"fetch", "-q", "origin", "main"})) return false;
    return git_output(root, {"merge-base", "--is-ancestor", "origin/main", "HEAD"}).has_value();
}

fs::path marker_path(const fs::path& root) { return root / "build" / "release" / "phase-b.pass"; }

bool marker_names_tree(const fs::path& root, const std::string& tree) {
    std::ifstream in(marker_path(root));
    std::string commit;
    std::string marked_tree;
    std::getline(in, commit);
    std::getline(in, marked_tree);
    return !tree.empty() && trim_line(marked_tree) == tree;
}

void write_marker(const fs::path& root, const std::string& commit, const std::string& tree) {
    std::error_code ec;
    fs::create_directories(marker_path(root).parent_path(), ec);
    std::ofstream(marker_path(root)) << commit << "\n" << tree << "\n";
}

bool make_copy(const fs::path& root, const fs::path& copy, const std::string& commit) {
    std::error_code ec;
    fs::remove_all(copy, ec);
    fs::create_directories(copy, ec);
    const fs::path archive = copy.string() + ".tar";
    const bool made = succeeded(run_in(root, {"git", "archive", "--format=tar", "-o", archive.string(), "HEAD"})) && succeeded(run_in(copy, {"tar", "-xf", archive.string(), "-C", copy.string()}));
    fs::remove(archive, ec);
    if (!made) return false;
    return succeeded(run_in(copy, {"git", "init", "-q", "."})) && succeeded(run_in(copy, {"git", "add", "-A"})) &&
           succeeded(run_in(copy, {"git", "-c", "user.name=gm-tool", "-c", "user.email=gm-tool@localhost", "commit", "-q", "-m", "tar copy of " + commit}));
}

bool phase_b_on_copy(const fs::path& root, const std::string& commit) {
    const fs::path copy = fs::temp_directory_path() / ("gm-ship-" + commit.substr(0, 8) + "-" + std::to_string(GM_PID));
    std::printf("phase-b: building and running Phase B on a tar copy of HEAD %s at %s\n", commit.c_str(), copy.string().c_str());
    if (!make_copy(root, copy, commit)) {
        std::puts("phase-b: could not make the tar copy of HEAD");
        return false;
    }
    bool ok = false;
    const char* seam = std::getenv("GM_SHIP_PHASE_B");
    if (seam != nullptr && *seam != '\0') {
        const auto outcome = run_in(copy, {"sh", "-c", seam});
        ok = succeeded(outcome);
        std::printf("phase-b: GM_SHIP_PHASE_B ran in the copy and %s\n", ok ? "passed" : "failed");
    } else {
        const std::string version = git_line(copy, {"rev-parse", "--short", "HEAD"}) + "-1";
        const auto configured = run_in(copy, {"cmake", "--preset", "release", "-DGMNEW_VERSION=" + version});
        if (!succeeded(configured)) std::printf("phase-b: configure of the copy failed: %s\n", configured.err.substr(0, 400).c_str());
        ok = succeeded(configured) && phase_b_command(copy, copy / "build" / "release") == 0;
    }
    std::error_code ec;
    if (ok) {
        fs::remove_all(copy, ec);
    } else {
        std::printf("phase-b: the copy is kept at %s; logs in %s\n", copy.string().c_str(), (copy / "build" / "release" / "phase-b-logs").string().c_str());
    }
    return ok;
}

enum class CiState { green, pending, red, unknown };

struct CiReport {
    CiState state = CiState::unknown;
    std::string detail;
};

CiReport ci_report(const fs::path& root, const std::string& sha) {
    CiReport report;
    const auto reply = run_in(root, {"gh", "run", "list", "--commit", sha, "--limit", "30", "--json", "name,status,conclusion", "--jq", ".[] | .name + \" \" + .status + \" \" + .conclusion"}, 120000);
    if (!succeeded(reply)) {
        report.detail = "gh run list failed: " + reply.err.substr(0, 200);
        return report;
    }
    std::map<std::string, std::pair<std::string, std::string>> newest;
    std::istringstream lines(reply.out);
    std::string line;
    while (std::getline(lines, line)) {
        std::istringstream words(line);
        std::string name, status, conclusion;
        words >> name >> status >> conclusion;
        newest.emplace(name, std::make_pair(status, conclusion));
    }
    report.state = CiState::green;
    for (const char* name : {"release", "arm-diagnose"}) {
        const auto found = newest.find(name);
        const std::string shown = found == newest.end() ? "no run yet" : found->second.first + (found->second.second.empty() ? "" : " " + found->second.second);
        report.detail += (report.detail.empty() ? "" : "; ") + std::string(name) + " " + shown;
        if (found == newest.end() || found->second.first != "completed") {
            if (report.state == CiState::green) report.state = CiState::pending;
        } else if (found->second.second != "success") {
            report.state = CiState::red;
        }
    }
    return report;
}

int ci_after_push(const fs::path& root, const std::string& sha) {
    const std::string url = git_line(root, {"remote", "get-url", "origin"});
    if (url.find("github.com") == std::string::npos) {
        std::printf("CI: not applicable: origin is not a GitHub remote (%s)\n", url.c_str());
        return 0;
    }
    if (!succeeded(run_in(root, {"gh", "--version"}, 20000))) {
        std::puts("CI: not applicable: gh is not installed, so the release and arm-diagnose runs cannot be read");
        return 0;
    }
    const char* wait_env = std::getenv("GM_SHIP_CI_WAIT_MINUTES");
    const int minutes = wait_env != nullptr && *wait_env != '\0' ? std::atoi(wait_env) : kDefaultCiWaitMinutes;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes(minutes);
    for (;;) {
        const CiReport report = ci_report(root, sha);
        if (report.state == CiState::green) {
            std::printf("CI: release and arm-diagnose are green on %s (%s)\n", sha.c_str(), report.detail.c_str());
            return 0;
        }
        if (report.state == CiState::red) {
            std::printf("CI: RED on %s: %s\n", sha.c_str(), report.detail.c_str());
            return 1;
        }
        if (report.state == CiState::unknown) {
            std::printf("CI: could not be read on %s: %s\n", sha.c_str(), report.detail.c_str());
            return 2;
        }
        if (std::chrono::steady_clock::now() >= deadline) {
            std::printf("CI: not confirmed on %s within %d minutes: %s\n", sha.c_str(), minutes, report.detail.c_str());
            return 2;
        }
        std::this_thread::sleep_for(std::chrono::seconds(60));
    }
}

}

int ship_push(const fs::path& root) {
    if (git_line(root, {"symbolic-ref", "--short", "-q", "HEAD"}) != "main") {
        std::puts("refused: ship pushes main only");
        return 1;
    }
    const auto dirty = git_output(root, {"status", "--porcelain", "--untracked-files=no"});
    if (!dirty || !dirty->empty()) {
        std::puts("refused: tracked changes are uncommitted or git failed; commit them with ship first; nothing pushed");
        return 1;
    }
    const std::string commit = git_line(root, {"rev-parse", "HEAD"});
    const std::string tree = git_line(root, {"rev-parse", "HEAD^{tree}"});
    if (commit.empty() || tree.empty()) return 1;
    if (!origin_main_contains_head(root)) {
        std::printf("refused: origin main moved or could not be fetched; HEAD %s is not on top of it; nothing pushed, nothing forced\n", commit.c_str());
        return 1;
    }
    if (git_line(root, {"rev-parse", "origin/main"}) == commit) {
        std::printf("nothing to push: HEAD %s is origin/main\n", commit.c_str());
        return 0;
    }
    const auto checks = run_gate(root);
    for (const auto& check : checks) std::printf("gate: %s %s: %s\n", check.name.c_str(), check.ok ? "ok" : "FAILED", check.detail.c_str());
    for (const auto& check : checks) {
        if (!check.ok) {
            std::puts("refused: the gate is red; nothing pushed");
            return 1;
        }
    }
    if (marker_names_tree(root, tree)) {
        std::printf("phase-b: the marker names tree %s, so Phase B is not rerun (delete %s to force it)\n", tree.c_str(), marker_path(root).string().c_str());
    } else {
        if (!phase_b_on_copy(root, commit)) {
            std::puts("refused: Phase B did not pass on the copy; nothing marked, nothing pushed");
            return 1;
        }
        write_marker(root, commit, tree);
        std::printf("phase-b: pass for tree %s; marker written for HEAD %s\n", tree.c_str(), commit.c_str());
    }
    if (!origin_main_contains_head(root)) {
        std::printf("refused: origin main moved during Phase B; HEAD %s is not on top of it; nothing pushed, nothing forced\n", commit.c_str());
        return 1;
    }
    if (!git_output(root, {"push", "-q", "origin", "main"})) {
        std::puts("refused: git push failed; nothing was forced");
        return 1;
    }
    std::printf("PUSHED %s\n", commit.c_str());
    return ci_after_push(root, commit);
}

}
