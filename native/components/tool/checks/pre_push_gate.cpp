#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

proc::Outcome git(const fs::path& dir, const std::vector<std::string>& args, const std::vector<std::pair<std::string, std::string>>& env = {}) {
    std::vector<std::string> argv{"env"};
    for (const auto& [key, value] : env) argv.push_back(key + "=" + value);
    argv.push_back("git");
    argv.insert(argv.end(), args.begin(), args.end());
    return proc::run(argv, dir, {}, 60000);
}

std::string line(const proc::Outcome& outcome) {
    std::string text = outcome.out;
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

void put(const fs::path& file, const std::string& text) {
    std::error_code ec;
    fs::create_directories(file.parent_path(), ec);
    std::ofstream out(file, std::ios::binary);
    out << text;
}

}

CheckResult check_pre_push_gate(const std::string& binary) {
    CheckResult result;
    const fs::path tool = fs::path(binary).parent_path().parent_path() / "tool" / "gm-tool";
    const auto top = git_output(fs::current_path(), {"rev-parse", "--show-toplevel"});
    std::string top_text = top.value_or(fs::current_path().string());
    while (!top_text.empty() && (top_text.back() == '\n' || top_text.back() == '\r')) top_text.pop_back();
    const fs::path hook = fs::path(top_text) / ".githooks" / "pre-push";
    if (!fs::exists(tool) || !fs::exists(hook)) {
        result.failures.push_back("no gm-tool next to " + binary + " or no hook at " + hook.string());
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-pre-push-check-" + std::to_string(stamp % 1000000));
    const fs::path remote = sandbox / "remote.git";
    const fs::path work = sandbox / "work";
    std::error_code ec;
    fs::create_directories(sandbox, ec);
    git(sandbox, {"init", "--bare", "-q", "remote.git"});
    git(remote, {"symbolic-ref", "HEAD", "refs/heads/main"});
    git(sandbox, {"clone", "-q", "remote.git", "work"});
    git(work, {"symbolic-ref", "HEAD", "refs/heads/main"});
    git(work, {"config", "user.name", "another-agent"});
    git(work, {"config", "user.email", "another-agent@example.invalid"});
    put(work / ".gitignore", "build/\n");
    put(work / "a.txt", "one\n");
    put(work / ".githooks" / "pre-push", read_text(hook));
    fs::permissions(work / ".githooks" / "pre-push", fs::perms::owner_all, ec);
    git(work, {"add", "-A"});
    git(work, {"commit", "-q", "-m", "seed"});
    git(work, {"push", "-q", "-u", "origin", "main"});
    git(work, {"config", "core.hooksPath", ".githooks"});
    auto remote_head = [&] { return line(git(remote, {"rev-parse", "main"})); };
    const std::vector<std::pair<std::string, std::string>> env{{"GM_TOOL", tool.string()}};
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what);
    };
    const std::string seeded = remote_head();

    put(work / "a.txt", "two\n");
    git(work, {"commit", "-q", "-am", "work from another agent"});
    const std::string second = line(git(work, {"rev-parse", "HEAD"}));
    auto refused = git(work, {"push", "origin", "main"}, env);
    expect(refused.exit_code != 0 && remote_head() == seeded, "a plain git push with no Phase B marker reached the remote");
    expect(refused.err.find("ship --push") != std::string::npos && refused.err.find("another-agent") != std::string::npos && refused.err.find(second.substr(0, 12)) != std::string::npos,
           "the refusal does not name the commit, its author and gm-tool ship --push: " + refused.err.substr(0, 400));

    const std::string tree = line(git(work, {"rev-parse", "HEAD^{tree}"}));
    put(work / "build" / "release" / "phase-b.pass", second + "\n" + tree + "\n");
    const auto allowed = git(work, {"push", "origin", "main"}, env);
    expect(allowed.exit_code == 0 && remote_head() == second, "a push of the tree a Phase B marker names was refused: " + allowed.err.substr(0, 300));

    put(work / "a.txt", "three\n");
    git(work, {"commit", "-q", "-am", "after the marker"});
    const auto stale = git(work, {"push", "origin", "main"}, env);
    expect(stale.exit_code != 0 && remote_head() == second, "a marker of an earlier tree let a newer commit through");

    git(work, {"branch", "topic"});
    const auto topic = git(work, {"push", "origin", "topic"}, env);
    expect(topic.exit_code == 0, "a branch other than main was held by the hook: " + topic.err.substr(0, 300));

    const auto removed = git(work, {"push", "origin", "--delete", "main"}, env);
    expect(removed.exit_code != 0 && remote_head() == second, "deleting main through the hook was not refused");

    fs::remove_all(sandbox, ec);
    result.summary = "a plain git push of main with no Phase B marker for its tree is refused naming the commit, its author and gm-tool ship --push; a marked tree, and a branch other than main, go through; a stale marker and a delete of main are refused";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_pre_push_gate(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
