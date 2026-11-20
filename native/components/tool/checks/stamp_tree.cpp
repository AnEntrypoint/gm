#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <string>
#include <system_error>

namespace gm::tool {
using namespace support;
namespace {

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;
constexpr long long kStampLimitMs = 60000;

fs::path checkout_root() {
    std::error_code ec;
    for (fs::path dir = fs::current_path(ec);; dir = dir.parent_path()) {
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) return {};
    }
}

std::string commit_of(const std::string& version_line) {
    const auto open = version_line.find('(');
    if (open == std::string::npos) return {};
    const auto close = version_line.find(')', open);
    if (close == std::string::npos) return {};
    return version_line.substr(open + 1, close - open - 1);
}

std::string first_word(const std::string& text) {
    std::istringstream words(text);
    std::string word;
    words >> word;
    return word;
}

struct Index {
    fs::path path;
    ~Index() {
        std::error_code ignored;
        fs::remove(path, ignored);
    }
};

}

CheckResult check_stamp_tree(const std::string& binary) {
    CheckResult result;
#if !defined(__linux__)
    result.summary = "skipped (not on this platform: the check hashes the tree with sha256sum)";
    return result;
#else
    const auto started = Clock::now();
    const fs::path repo = checkout_root();
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const std::string version_line = proc::run({binary, "--version"}, {}, {}, kStampLimitMs).out;
    const std::string stamp = commit_of(version_line);
    if (stamp.empty()) {
        result.failures.push_back("the build reports no commit stamp: " + version_line.substr(0, 200));
        return result;
    }
    const Index index{fs::temp_directory_path() / ("gm-stamp-tree-" + std::to_string(started.time_since_epoch().count()) + ".index")};
    const std::string env = "GIT_INDEX_FILE=" + index.path.string();
    const auto read = proc::run({"env", env, "git", "read-tree", "HEAD"}, repo, {}, kStampLimitMs);
    const auto add = proc::run({"env", env, "git", "add", "--all", "--", "native", "defaults"}, repo, {}, kStampLimitMs);
    const auto write = proc::run({"env", env, "git", "write-tree"}, repo, {}, kStampLimitMs);
    if (!read.started || read.exit_code != 0 || !add.started || add.exit_code != 0 || !write.started || write.exit_code != 0) {
        result.failures.push_back("could not write the working tree's tree with git: " + write.err.substr(0, 200));
        return result;
    }
    const std::string tree = first_word(write.out);
    const std::string digest = first_word(proc::run({"sh", "-c", "printf %s " + tree + " | sha256sum"}, {}, {}, kStampLimitMs).out);
    const std::string expected = digest.substr(0, 12);
    if (expected != stamp) {
        result.failures.push_back("the build stamp " + stamp + " is not the stamp of the tree it was built from (" + expected + ", tree " + tree + ")");
    }
    const double wall = std::chrono::duration<double>(Clock::now() - started).count();
    if (result.failures.empty()) result.summary = "the stamp " + stamp + " is the working tree's native and defaults tree " + tree + " (wall " + std::to_string(wall) + " s)";
    return result;
#endif
}

}
