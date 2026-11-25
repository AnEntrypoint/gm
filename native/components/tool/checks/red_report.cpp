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

void put(const fs::path& file, const std::string& text) {
    std::error_code ec;
    fs::create_directories(file.parent_path(), ec);
    std::ofstream out(file, std::ios::binary);
    out << text;
}

bool has(const std::string& text, const std::string& needle) { return text.find(needle) != std::string::npos; }

std::size_t count_of(const std::string& text, const std::string& needle) {
    std::size_t count = 0;
    for (auto at = text.find(needle); at != std::string::npos; at = text.find(needle, at + needle.size())) ++count;
    return count;
}

}

CheckResult check_red_report(const std::string& binary) {
    CheckResult result;
    const fs::path tool = fs::path(binary).parent_path().parent_path() / "tool" / "gm-tool";
    if (!fs::exists(tool)) {
        result.failures.push_back("no gm-tool next to " + binary);
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-red-report-check-" + std::to_string(stamp % 1000000));
    const fs::path work = sandbox / "work";
    std::error_code ec;
    fs::create_directories(work, ec);
    git(work, {"init", "-q", "."});
    git(work, {"config", "user.name", "first-agent"});
    git(work, {"config", "user.email", "first@example.invalid"});
    put(work / "a.txt", "one\n");
    git(work, {"add", "-A"});
    git(work, {"commit", "-q", "-m", "an earlier change"});
    git(work, {"config", "user.name", "second-agent"});
    git(work, {"config", "user.email", "second@example.invalid"});
    put(work / "a.txt", "two\n");
    git(work, {"commit", "-q", "-am", "the change that broke it"});

    const fs::path logs = sandbox / "phase-b-logs";
    put(logs / "check-alpha.log", "check-alpha: 1 failure(s)\n- the alpha page was not cut\n");
    put(logs / "check-beta.log", "check-beta: 1 failure(s)\n- the beta hint is missing\n");
    const fs::path log = sandbox / "phase-b.log";
    put(log, "phase-b: check-gamma ok 1.0 s\nphase-b: check-alpha FAILED 0.1 s, log /runner/phase-b-logs/check-alpha.log\nphase-b: check-beta FAILED 0.2 s, log /runner/phase-b-logs/check-beta.log\nphase-b: check-alpha FAILED 0.1 s, log /runner/phase-b-logs/check-alpha.log\nphase-b: checks: 3 run, 2 failed\n");
    const fs::path summary = sandbox / "summary.md";
    const auto red = proc::run({"env", "GITHUB_STEP_SUMMARY=" + summary.string(), tool.string(), "red-report", log.string(), logs.string()}, work, {}, 60000);
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what);
    };
    expect(red.exit_code == 0, "red-report exited " + std::to_string(red.exit_code) + ": " + red.err.substr(0, 300));
    expect(has(red.out, "second-agent") && has(red.out, "the change that broke it"), "the report does not name the tip commit and its author: " + red.out.substr(0, 400));
    expect(has(red.out, "first-agent"), "the report does not list the earlier commits as candidates: " + red.out.substr(0, 400));
    expect(has(red.out, "2 failed check(s): check-alpha check-beta"), "the report does not name each failed check once: " + red.out.substr(0, 400));
    expect(count_of(red.out, "::error title=Phase B red::check-alpha") == 1, "the failed check is not annotated exactly once");
    expect(has(red.out, "the alpha page was not cut") && has(red.out, "the beta hint is missing"), "the report does not show each failed check's own log");
    expect(has(read_text(summary), "Phase B is red") && has(read_text(summary), "check-beta"), "the job summary was not written");

    put(log, "phase-b: configure of the copy failed: no compiler\n");
    const auto unnamed = proc::run({tool.string(), "red-report", log.string()}, work, {}, 60000);
    expect(unnamed.exit_code == 0 && has(unnamed.out, "no check was named FAILED") && has(unnamed.out, "no compiler"), "a red with no named check does not show the log's last lines: " + unnamed.out.substr(0, 300));
    fs::remove_all(sandbox, ec);
    result.summary = "red-report names the tip commit and its author, the earlier commits, each failed check once with its own log head, annotates each, writes the job summary, and shows the log's last lines when no check is named";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_red_report(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
