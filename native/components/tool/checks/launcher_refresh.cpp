#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

std::string slurp(const fs::path& file) {
    std::ifstream in(file);
    std::stringstream text;
    text << in.rdbuf();
    return text.str();
}

}

CheckResult check_launcher_refresh(const std::string& binary) {
    CheckResult result;
    const fs::path host = fs::path(binary).parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
    fs::path repo;
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) {
            repo = dir;
            break;
        }
        if (dir == dir.parent_path()) break;
    }
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const fs::path scratch = fs::temp_directory_path() / ("gm-launcher-refresh-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count() % 1000000));
    const fs::path home = scratch / "home";
    std::error_code ec;
    fs::create_directories(home, ec);
    auto install = [&] { return proc::run(support::install_argv(home, host / "gm", build, repo), repo, {}, 120000); };
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what);
    };
    const auto first = install();
    expect(first.started && first.exit_code == 0, "the first install failed: " + support::failure_text(first));
    const fs::path pw = home / ".gmnew" / "pw";
    const fs::path launcher = pw / "bin" / "playwriter-project";
    expect(contains(slurp(launcher), "SCAN_TIME_PATTERN") && contains(slurp(launcher), "WAIT_HINT_MS"), "a fresh install did not leave the launcher with the listing and fixed-wait hooks");

    std::ostringstream older;
    std::istringstream lines(slurp(launcher));
    for (std::string line; std::getline(lines, line);)
        if (!contains(line, "SCAN_TIME_PATTERN") && !contains(line, "WAIT_HINT_MS")) older << line << "\n";
    std::ofstream(launcher) << older.str();
    fs::create_directories(pw / "node_modules" / "keep", ec);
    std::ofstream(pw / "node_modules" / "keep" / "sentinel") << "installed packages\n";

    const auto second = install();
    expect(second.started && second.exit_code == 0, "the install over an older launcher failed: " + support::failure_text(second));
    expect(contains(second.out, "launcher patches refreshed"), "the install over an older launcher did not report a launcher refresh: " + second.out.substr(0, 300));
    expect(!contains(second.out, "installed playwriter"), "an older launcher caused a full playwriter reinstall, with npm ci replacing node_modules");
    expect(fs::exists(pw / "node_modules" / "keep" / "sentinel", ec), "node_modules was replaced while only the launcher was older");
    expect(contains(slurp(launcher), "SCAN_TIME_PATTERN") && contains(slurp(launcher), "WAIT_HINT_MS"), "the launcher still lacks the listing and fixed-wait hooks after the install");
    fs::remove_all(scratch, ec);
    if (result.failures.empty()) result.summary = "an install over a launcher that lacks a newer hook reapplies the launcher patches and leaves node_modules alone, where the earlier install replaced the whole playwriter tree";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_launcher_refresh(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
