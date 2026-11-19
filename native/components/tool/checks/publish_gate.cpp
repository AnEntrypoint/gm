#include "gm/tool.hpp"

#include <chrono>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace gm::tool {
namespace {

constexpr const char* kCheck = "check-publish-gate";
constexpr const char* kWorkflow = ".github/workflows/release.yml";

std::vector<std::string> lines_of(const std::string& text) {
    std::vector<std::string> lines;
    std::istringstream in(text);
    for (std::string line; std::getline(in, line);) lines.push_back(line);
    return lines;
}

}

CheckResult check_publish_gate(const std::string&) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    std::ifstream in(kWorkflow);
    if (!in) {
        result.failures.push_back(std::string(kCheck) + ": " + kWorkflow + " is not at this path; run the check from the checkout root");
        return result;
    }
    std::stringstream buffer;
    buffer << in.rdbuf();
    const std::vector<std::string> lines = lines_of(buffer.str());
    std::size_t build = lines.size();
    std::size_t publish = lines.size();
    for (std::size_t i = 0; i < lines.size(); ++i) {
        if (lines[i] == "  build:") build = i;
        if (lines[i] == "  publish:") publish = i;
    }
    if (build == lines.size()) result.failures.push_back("the release workflow has no build job");
    if (publish == lines.size()) result.failures.push_back("the release workflow has no publish job");
    std::string gate;
    for (std::size_t i = publish + 1; publish != lines.size() && i < lines.size() && gate.empty(); ++i) {
        if (lines[i].rfind("    if:", 0) == 0) gate = lines[i];
    }
    if (gate.empty()) result.failures.push_back("the publish job has no if: gate");
    if (!gate.empty()) {
        if (gate.find("needs.build.result == 'success'") != std::string::npos)
            result.failures.push_back("publish still needs every build leg to succeed, so one failed leg stops the manifest: " + gate);
        if (gate.find("always()") == std::string::npos || gate.find("needs.build.result != 'cancelled'") == std::string::npos || gate.find("needs.build-windows.result != 'cancelled'") == std::string::npos)
            result.failures.push_back("publish does not run after a failed build leg: " + gate);
    }
    bool fail_fast_off = false;
    for (std::size_t i = build; build != lines.size() && publish != lines.size() && i < publish; ++i) {
        if (lines[i] == "      fail-fast: false") fail_fast_off = true;
    }
    if (!fail_fast_off) result.failures.push_back("the build matrix does not set fail-fast: false, so one failed leg cancels the others");
    const auto wall = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
    result.summary = "publish runs after a failed build leg (gate: " + gate + "), and the build matrix keeps its other legs (fail-fast: false) (wall " + std::to_string(wall) + " ms)";
    return result;
}

}
