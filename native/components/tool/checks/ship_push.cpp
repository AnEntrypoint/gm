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

proc::Outcome git(const fs::path& dir, const std::vector<std::string>& args) {
    std::vector<std::string> argv{"git"};
    argv.insert(argv.end(), args.begin(), args.end());
    return proc::run(argv, dir, {}, 60000);
}

std::string line(const proc::Outcome& outcome) {
    std::string text = outcome.out;
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

void put(const fs::path& file, const std::string& text) {
    std::ofstream out(file, std::ios::binary);
    out << text;
}

void commit_file(const fs::path& work, const std::string& name, const std::string& text) {
    put(work / name, text);
    git(work, {"add", "-A"});
    git(work, {"commit", "-q", "-m", "change " + name});
}

}

CheckResult check_ship_push(const std::string& binary) {
    CheckResult result;
    const fs::path tool = fs::path(binary).parent_path().parent_path() / "tool" / "gm-tool";
    if (!fs::exists(tool)) {
        result.failures.push_back("no gm-tool next to " + binary);
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-ship-push-check-" + std::to_string(stamp % 1000000));
    const fs::path remote = sandbox / "remote.git";
    const fs::path work = sandbox / "work";
    const fs::path other = sandbox / "other";
    std::error_code ec;
    fs::create_directories(sandbox, ec);
    git(sandbox, {"init", "--bare", "-q", "remote.git"});
    git(remote, {"symbolic-ref", "HEAD", "refs/heads/main"});
    git(sandbox, {"clone", "-q", "remote.git", "work"});
    git(work, {"symbolic-ref", "HEAD", "refs/heads/main"});
    git(work, {"config", "user.name", "lanmower"});
    git(work, {"config", "user.email", "lanmower@example.invalid"});
    put(work / ".gitignore", "build/\n");
    put(work / "README.md", "readme\n");
    put(work / "DESIGN.md", "design\n");
    put(work / "AGENTS.md", "agents\n");
    git(work, {"add", "-A"});
    git(work, {"commit", "-q", "-m", "seed"});
    git(work, {"push", "-q", "-u", "origin", "main"});
    auto remote_head = [&] { return line(git(remote, {"rev-parse", "main"})); };
    auto local_head = [&] { return line(git(work, {"rev-parse", "HEAD"})); };
    std::vector<std::string> copies;
    auto push = [&](const std::string& phase_b) {
        const auto outcome = proc::run({"env", "GM_SHIP_PHASE_B=" + phase_b, "GM_SHIP_CI_WAIT_MINUTES=0", tool.string(), "ship", "--push"}, work, {}, 120000);
        const std::string kept = "the copy is kept at ";
        const auto at = outcome.out.find(kept);
        if (at != std::string::npos) copies.push_back(outcome.out.substr(at + kept.size(), outcome.out.find(';', at) - at - kept.size()));
        return outcome;
    };
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what);
    };

    commit_file(work, "a.txt", "one\n");
    const std::string first = local_head();
    auto outcome = push("true");
    expect(outcome.exit_code == 0 && outcome.out.find("PUSHED " + first) != std::string::npos, "a new commit was not pushed through ship --push with a passing Phase B on the copy: " + outcome.out.substr(0, 400));
    expect(remote_head() == first, "the remote does not hold the pushed commit " + first);
    expect(outcome.out.find("CI: not applicable") != std::string::npos, "the CI result after the push was not reported as not applicable for a remote that is not GitHub: " + outcome.out.substr(0, 400));
    expect(outcome.out.find("origin is not a GitHub remote") != std::string::npos && outcome.out.find("green") == std::string::npos, "the push reported CI results for a remote that has none");
    std::ifstream marker(work / "build" / "release" / "phase-b.pass");
    std::string marked_commit, marked_tree;
    std::getline(marker, marked_commit);
    std::getline(marker, marked_tree);
    expect(marked_commit == first && marked_tree == line(git(work, {"rev-parse", "HEAD^{tree}"})), "the Phase B marker does not name HEAD and its tree id: " + marked_commit + " " + marked_tree);

    commit_file(work, "b.txt", "two\n");
    const std::string second = local_head();
    outcome = push("false");
    expect(outcome.exit_code != 0 && outcome.out.find("Phase B did not pass") != std::string::npos, "a red Phase B on the copy did not refuse the push: " + outcome.out.substr(0, 300));
    expect(remote_head() == first, "a red Phase B still moved the remote");

    const std::string second_tree = line(git(work, {"rev-parse", "HEAD^{tree}"}));
    fs::create_directories(work / "build" / "release", ec);
    put(work / "build" / "release" / "phase-b.pass", "earlier\n" + second_tree + "\n");
    outcome = push("false");
    expect(outcome.exit_code == 0 && outcome.out.find("not rerun") != std::string::npos && remote_head() == second, "a marker that names HEAD's tree id was not reused: " + outcome.out.substr(0, 300));

    commit_file(work, "c.txt", "three\n");
    put(work / "a.txt", "dirty\n");
    outcome = push("true");
    expect(outcome.exit_code != 0 && outcome.out.find("uncommitted") != std::string::npos && remote_head() == second, "a dirty tracked tree did not refuse the push: " + outcome.out.substr(0, 300));
    git(work, {"checkout", "-q", "--", "a.txt"});

    git(sandbox, {"clone", "-q", "remote.git", "other"});
    git(other, {"config", "user.name", "lanmower"});
    git(other, {"config", "user.email", "lanmower@example.invalid"});
    commit_file(other, "moved.txt", "moved\n");
    git(other, {"push", "-q", "origin", "HEAD:main"});
    const std::string moved = remote_head();
    outcome = push("true");
    expect(outcome.exit_code != 0 && outcome.out.find("origin main moved") != std::string::npos && remote_head() == moved, "a moved origin did not refuse the push, or the remote was changed: " + outcome.out.substr(0, 300));
    git(work, {"reset", "-q", "--hard", "origin/main"});

    put(work / "bad.txt", std::string("caf\xc3\xa9\n"));
    git(work, {"add", "-A"});
    git(work, {"commit", "-q", "-m", "non-ascii"});
    outcome = push("true");
    expect(outcome.exit_code != 0 && outcome.out.find("the gate is red") != std::string::npos && remote_head() == moved, "a red gate did not refuse the push: " + outcome.out.substr(0, 300));
    git(work, {"reset", "-q", "--hard", "origin/main"});

    outcome = push("true");
    expect(outcome.exit_code == 0 && outcome.out.find("nothing to push") != std::string::npos, "a HEAD that is origin/main was not reported as nothing to push: " + outcome.out.substr(0, 300));

    for (const std::string& copy : copies) fs::remove_all(copy, ec);
    fs::remove_all(sandbox, ec);
    result.summary = "ship --push in a scratch repo with a local bare remote pushes a new commit after Phase B on a tar copy and writes a marker for HEAD's tree id, reports CI as not applicable without GitHub, reuses a marker for the same tree, and refuses a red Phase B, a dirty tracked tree, a moved origin and a red gate without touching the remote";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_ship_push(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
