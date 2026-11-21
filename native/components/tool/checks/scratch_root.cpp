#include "gm/tool.hpp"
#include "support.hpp"

#include <cstdlib>
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

#if !defined(_WIN32)
#include <unistd.h>
#endif

namespace gm::tool {
namespace {

std::size_t entries_in(const std::filesystem::path& dir) {
    std::size_t count = 0;
    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator(dir, ec)) {
        (void) entry;
        ++count;
    }
    return count;
}

}

CheckResult check_scratch_root(const std::string& binary) {
    CheckResult result;
#if defined(_WIN32)
    result.summary = "skipped (the scratch root is checked where TMPDIR names the temporary directory)";
    return result;
#else
    const std::filesystem::path tool = proc::process_exe(static_cast<long long>(getpid()));
    if (tool.empty()) {
        result.failures.push_back("could not find the path of this gm-tool");
        return result;
    }
    const std::filesystem::path probe = std::filesystem::temp_directory_path() / "probe";
    std::error_code ec;
    std::filesystem::create_directories(probe, ec);
    std::vector<std::string> environment{"TMPDIR=" + probe.string()};
    for (const char* name : {"PATH", "HOME", "GMNEW_AUTO_UPDATE"}) {
        if (const char* value = std::getenv(name)) environment.push_back(std::string(name) + "=" + value);
    }
    for (const char* check : {"check-target-names", "no-such-check"}) {
        proc::RunOptions options;
        options.env = environment;
        options.timeout_ms = 120000;
        const proc::Outcome outcome = proc::run({tool.string(), "check", binary, check}, options);
        if (!outcome.started) result.failures.push_back("could not run gm-tool check " + std::string(check));
        else if (entries_in(probe) != 0) result.failures.push_back("gm-tool check " + std::string(check) + " left " + std::to_string(entries_in(probe)) + " entries under its TMPDIR");
    }
    std::filesystem::remove_all(probe, ec);
    if (result.failures.empty()) result.summary = "a gm-tool check run leaves nothing under its TMPDIR, whether the check passes or no check matches";
    return result;
#endif
}

}
