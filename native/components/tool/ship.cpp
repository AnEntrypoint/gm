#include "gm/tool.hpp"

#include <chrono>
#include <cstdio>
#include <fstream>
#include <regex>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

proc::Outcome run_in(const fs::path& root, const std::vector<std::string>& argv, std::uint64_t timeout_ms = 0) {
    return proc::run(argv, root, {}, timeout_ms);
}

bool succeeded(const proc::Outcome& outcome) { return outcome.started && outcome.exit_code == 0; }

void print_gate(const std::vector<GateCheck>& checks) {
    for (const auto& check : checks) std::printf("gate: %s %s: %s\n", check.name.c_str(), check.ok ? "ok" : "FAILED", check.detail.c_str());
}

bool gate_passed(const std::vector<GateCheck>& checks) {
    for (const auto& check : checks)
        if (!check.ok) return false;
    return true;
}

std::optional<std::string> stamp_of(const fs::path& root) {
    const auto temp = fs::temp_directory_path() / ("gm-stamp-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + ".hpp");
    const auto outcome = run_in(root, {"cmake", "-DSOURCE_DIR=" + root.string(), "-DOUTPUT=" + temp.string(), "-P", (root / "cmake" / "gmnew_stamp.cmake").string()});
    if (!succeeded(outcome)) return std::nullopt;
    std::ifstream in(temp);
    std::string line;
    std::optional<std::string> stamp;
    const std::regex pattern("kBuildVersion = \"([^\"]*)\";");
    while (std::getline(in, line)) {
        std::smatch match;
        if (std::regex_search(line, match, pattern)) stamp = match[1].str();
    }
    std::error_code ec;
    fs::remove(temp, ec);
    return stamp;
}

}

int phase_b_command(const fs::path& root, const fs::path& build) {
    const auto dirty = git_output(root, {"status", "--porcelain", "--untracked-files=no"});
    if (!dirty || !dirty->empty()) {
        std::puts("phase-b: tracked changes are uncommitted or git failed; commit them with ship first");
        return 1;
    }
    if (!succeeded(run_in(root, {"cmake", "--preset", "release"}))) {
        std::puts("phase-b: configure failed");
        return 1;
    }
    if (!succeeded(run_in(root, {"cmake", "--build", build.string(), "-j", "8"}))) {
        std::puts("phase-b: build failed");
        return 1;
    }
    const auto tree_stamp = stamp_of(root);
    if (!tree_stamp || tree_stamp->empty()) {
        std::puts("phase-b: stamp script failed");
        return 1;
    }
    const fs::path gm = build / "native" / "components" / "host" / "gm";
    const auto version = run_in(root, {gm.string(), "--version"}, 20000);
    std::istringstream words(version.out);
    std::string built_stamp;
    words >> built_stamp;
    const auto stamp_head = git_output(root, {"rev-parse", "HEAD"});
    if (!stamp_head || stamp_head->size() < 7) {
        std::puts("phase-b: git rev-parse HEAD failed");
        return 1;
    }
    const bool ci_shape = built_stamp.rfind(stamp_head->substr(0, 7) + "-", 0) == 0;
    if (built_stamp != *tree_stamp && !ci_shape) {
        std::printf("phase-b: built stamp '%s' does not match the tree stamp '%s'\n", built_stamp.c_str(), tree_stamp->c_str());
        return 1;
    }
    if (run_phase_b_checks(root, build, gm.string()) != 0) {
        std::puts("phase-b: checks failed; nothing marked, nothing to push");
        return 1;
    }
    const auto head = git_output(root, {"rev-parse", "HEAD"});
    if (!head) return 1;
    std::string commit = *head;
    while (!commit.empty() && (commit.back() == '\n' || commit.back() == '\r')) commit.pop_back();
    std::ofstream(build / "phase-b.pass") << commit << "\n";
    std::printf("phase-b: pass at %s; push with ship --push\n", commit.c_str());
    return 0;
}

int ship_command(const fs::path& root, const std::vector<std::string>& args) {
    if (args.size() == 1 && args[0] == "--push") {
        const auto head = git_output(root, {"rev-parse", "HEAD"});
        if (!head) return 1;
        std::string commit = *head;
        while (!commit.empty() && (commit.back() == '\n' || commit.back() == '\r')) commit.pop_back();
        std::ifstream marker_in(root / "build" / "release" / "phase-b.pass");
        std::string marked;
        std::getline(marker_in, marked);
        if (marked != commit) {
            std::printf("refused: no passing Phase B at HEAD %s; run phase-b first\n", commit.c_str());
            return 1;
        }
        if (!git_output(root, {"push", "-q", "origin", "main"})) return 1;
        std::printf("PUSHED %s\n", commit.c_str());
        return 0;
    }
    if (args.size() < 2) {
        std::puts("usage: gm-tool ship \"<subject>\" <paths...>  |  gm-tool ship --push");
        return 2;
    }
    const std::string subject = args[0];
    const std::vector<std::string> paths(args.begin() + 1, args.end());
    const auto branch = git_output(root, {"symbolic-ref", "--short", "-q", "HEAD"});
    std::string name = branch ? *branch : std::string();
    while (!name.empty() && (name.back() == '\n' || name.back() == '\r')) name.pop_back();
    if (name != "main") {
        std::printf("refused: ship commits on main, not on '%s'\n", name.c_str());
        return 1;
    }
    for (const char* ident : {"GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"}) {
        const auto who = git_output(root, {"var", ident});
        if (!who || who->rfind("lanmower <", 0) != 0) {
            std::printf("refused: %s name must be lanmower\n", ident);
            return 1;
        }
    }
    if (std::regex_search(subject, std::regex("co-authored-by|signed-off-by|generated with", std::regex::icase))) {
        std::puts("refused: the commit message carries a trailer");
        return 1;
    }
    for (const auto& path : paths) {
        std::error_code ec;
        const bool present = fs::exists(root / path, ec);
        const bool tracked = git_output(root, {"ls-files", "--error-unmatch", "--", path}).has_value();
        const bool in_head = git_output(root, {"cat-file", "-e", "HEAD:" + path}).has_value();
        if (!present && !tracked && !in_head) {
            std::printf("refused: %s is neither in the tree nor tracked\n", path.c_str());
            return 1;
        }
    }
    for (const auto& path : paths) {
        std::error_code ec;
        const bool ok = fs::exists(root / path, ec) ? git_output(root, {"add", "-A", "--", path}).has_value()
                                                   : git_output(root, {"rm", "-q", "--cached", "--ignore-unmatch", "--", path}).has_value();
        if (!ok) return 1;
    }
    const auto checks = run_gate(root);
    print_gate(checks);
    if (!gate_passed(checks)) {
        std::vector<std::string> reset{"reset", "-q", "--"};
        reset.insert(reset.end(), paths.begin(), paths.end());
        git_output(root, reset);
        std::puts("NOT COMMITTED: the gate failed; the named paths are unstaged");
        return 1;
    }
    std::vector<std::string> commit{"commit", "-q", "-m", subject, "--"};
    commit.insert(commit.end(), paths.begin(), paths.end());
    if (!git_output(root, commit)) return 1;
    const auto head = git_output(root, {"rev-parse", "HEAD"});
    std::string sha = head ? *head : std::string("?");
    while (!sha.empty() && (sha.back() == '\n' || sha.back() == '\r')) sha.pop_back();
    std::printf("COMMITTED %s, local only; gate passed\n", sha.c_str());
    return 0;
}

}
