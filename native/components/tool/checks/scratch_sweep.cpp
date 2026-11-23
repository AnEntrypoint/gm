#include "gm/tool.hpp"
#include "support.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <set>
#include <string>
#include <system_error>
#include <vector>

#if !defined(_WIN32)
#include <unistd.h>
#endif

namespace gm::tool {
namespace fs = std::filesystem;

#if !defined(_WIN32)
namespace {

void make_dir(const fs::path& dir, const std::string& marker_inside, const std::string& marker_beside) {
    std::error_code ec;
    fs::create_directories(dir, ec);
    std::ofstream(dir / "payload.bin") << "scratch payload\n";
    if (!marker_inside.empty()) std::ofstream(dir / marker_inside) << "1\n";
    if (!marker_beside.empty()) std::ofstream(marker_beside) << "1\n";
}

}

CheckResult check_scratch_sweep(const std::string& binary) {
    CheckResult result;
    const fs::path tool = proc::process_exe(static_cast<long long>(getpid()));
    if (tool.empty()) {
        result.failures.push_back("could not find the path of this gm-tool");
        return result;
    }
    std::set<long long> alive;
    for (const auto& row : proc::process_table()) alive.insert(row.pid);
    std::vector<long long> dead;
    for (long long pid = 4000000; pid > 3000000 && dead.size() < 4; --pid)
        if (!alive.count(pid)) dead.push_back(pid);
    const long long live = static_cast<long long>(getpid());
    const fs::path probe = fs::temp_directory_path() / "sweep-probe";
    std::error_code ec;
    fs::create_directories(probe, ec);
    const std::string hex = "abcdef12";
    auto root = [&](long long pid) { return probe / ("g" + std::to_string(pid)); };
    auto copy = [&](long long pid) { return probe / ("gm-ship-" + hex + "-" + std::to_string(pid)); };
    auto beside = [&](long long pid) { return (probe / ("gm-ship-" + hex + "-" + std::to_string(pid) + kShipCopyMarkerSuffix)).string(); };
    make_dir(root(dead[0]), kScratchMarker, "");
    make_dir(root(dead[1]), "", "");
    make_dir(root(live), kScratchMarker, "");
    make_dir(copy(dead[2]), "", beside(dead[2]));
    make_dir(copy(dead[3]), "", "");
    make_dir(copy(live), "", beside(live));
    make_dir(probe / "g1obs", kScratchMarker, "");

    std::vector<std::string> environment{"TMPDIR=" + probe.string()};
    for (const char* name : {"PATH", "HOME", "GMNEW_AUTO_UPDATE"}) {
        if (const char* value = std::getenv(name)) environment.push_back(std::string(name) + "=" + value);
    }
    proc::RunOptions options;
    options.env = environment;
    options.timeout_ms = 120000;
    const proc::Outcome outcome = proc::run({tool.string(), "check", binary, "no-such-check"}, options);
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what);
    };
    expect(outcome.started, "could not run gm-tool check");
    expect(!fs::exists(root(dead[0]), ec), "the scratch root of a process that ended, with the gm-tool marker, was not removed");
    expect(fs::exists(root(dead[1]), ec), "a directory named like a scratch root but without the gm-tool marker was removed");
    expect(fs::exists(root(live), ec), "the scratch root of a live process was removed");
    expect(!fs::exists(copy(dead[2]), ec) && !fs::exists(beside(dead[2]), ec), "a ship copy of a process that ended, with its marker, was not removed with its marker");
    expect(fs::exists(copy(dead[3]), ec), "a ship copy without a marker was removed");
    expect(fs::exists(copy(live), ec), "the ship copy of a live process was removed");
    expect(fs::exists(probe / "g1obs", ec), "a directory that is not named g and a process id was removed");
    fs::remove_all(probe, ec);
    if (result.failures.empty()) result.summary = "a gm-tool check run removes the scratch roots and ship copies that gm-tool marked and whose process ended, and spares a live process's, an unmarked directory and any other name";
    return result;
}
#else

CheckResult check_scratch_sweep(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}
#endif

}
