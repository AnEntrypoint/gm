#include "gm/proc.hpp"
#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

}

CheckResult check_stamp_override(const std::string&) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const fs::path repo = checkout_root();
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const std::string short_head = first_word(proc::run({"git", "rev-parse", "--short=7", "HEAD"}, repo, {}, 30000).out);
    if (short_head.size() != 7) {
        result.failures.push_back("could not read the 7-character HEAD of the checkout");
        return result;
    }
    const std::string override_version = short_head + "-1";
    const fs::path scratch = fs::temp_directory_path() / ("gm-stamp-override-" + short_head);
    std::error_code ec;
    fs::create_directories(scratch, ec);
    const fs::path header = scratch / "gmnew_build_info.hpp";
    const proc::Outcome stamp = proc::run({"cmake", "-DSOURCE_DIR=" + repo.string(), "-DOUTPUT=" + header.string(), "-DOVERRIDE=" + override_version, "-P", (repo / "cmake" / "gmnew_stamp.cmake").string()}, repo, {}, 120000);
    std::ostringstream text;
    if (std::ifstream in(header); in) text << in.rdbuf();
    const std::string expected = "kBuildVersion = \"" + override_version + "\";";
    if (!stamp.started || stamp.exit_code != 0)
        result.failures.push_back("the stamp script did not run: " + stamp.err.substr(0, 300));
    else if (text.str().find(expected) == std::string::npos)
        result.failures.push_back("the stamp script ignored the 7-character override " + override_version + " of HEAD; the header does not carry it");
    result.summary = "the stamp script takes the 7-character HEAD of the checkout as the override of the build version, so a build configured with -DGMNEW_VERSION=<7 characters>-1 reports that version and not a -dev one";
    fs::remove_all(scratch, ec);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary += " (wall " + std::to_string(wall) + " s)";
    return result;
}

}
