#include "gm/target.hpp"
#include "gm/tool.hpp"
#include "support.hpp"

#include <filesystem>
#include <fstream>
#include <regex>
#include <sstream>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

}

CheckResult check_target_names(const std::string&) {
    CheckResult result;
    const std::vector<std::pair<std::pair<std::string, std::string>, std::string>> table{
        {{"linux", "x64"}, "x64-linux"},     {{"linux", "arm64"}, "arm64-linux"},     {{"macos", "x64"}, "x64-macos"},
        {{"macos", "arm64"}, "arm64-macos"}, {{"windows", "x64"}, "x64-windows"},     {{"windows", "arm64"}, "arm64-windows"},
        {{"linux", "riscv"}, "unknown"},     {{"plan9", "x64"}, "unknown"}};
    for (const auto& [platform, expected] : table) {
        const std::string key = gm::target_key(platform.first, platform.second);
        if (key != expected) result.failures.push_back(platform.second + " on " + platform.first + " derived \"" + key + "\", the manifest key is \"" + expected + "\"");
    }
    const std::string own = gm::platform_target();
    bool listed = false;
    for (const std::string_view target : gm::kTargets) listed = listed || target == own;
    if (!listed) result.failures.push_back("this build's platform target \"" + own + "\" is not a manifest key");

    const fs::path root = checkout_root();
    if (root.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const std::regex literal(R"re("(x64|arm64)-(linux|macos|windows)")re");
    std::vector<fs::path> sources{root / "native/components/host/update.cpp", root / "native/components/tool/release.cpp"};
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(root / "native/components/tool/checks", ec)) {
        if (entry.path().extension() == ".cpp" && entry.path().filename() != "target_names.cpp") sources.push_back(entry.path());
    }
    for (const fs::path& source : sources) {
        const std::string text = read_text(source);
        std::smatch found;
        if (std::regex_search(text, found, literal)) result.failures.push_back(source.filename().string() + " names the target " + found.str(0) + " as a literal; use gm::platform_target()");
    }
    for (const char* name : {"update_stream.cpp", "relay_reexec.cpp", "update_order.cpp", "handover_in_flight.cpp", "body_reexec.cpp"}) {
        if (read_text(root / "native/components/tool/checks" / name).find("gm::platform_target()") == std::string::npos)
            result.failures.push_back(std::string(name) + " does not take its target from gm::platform_target()");
    }
    if (read_text(root / "native/components/host/update.cpp").find("gm::platform_target()") == std::string::npos)
        result.failures.push_back("update.cpp target_name does not use gm::platform_target()");
    if (result.failures.empty()) result.summary = "the six manifest keys derive from each OS and architecture, an unsupported pair derives \"unknown\", and no witness, the updater or release.cpp names a target as a literal";
    return result;
}

}
