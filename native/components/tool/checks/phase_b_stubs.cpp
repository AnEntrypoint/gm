#include "gm/tool.hpp"

#include <chrono>
#include <string>
#include <utility>
#include <vector>

namespace gm::tool {

CheckResult check_phase_b_stubs(const std::string& binary) {
    CheckResult result;
    const auto began = std::chrono::steady_clock::now();
    const std::vector<std::pair<std::string, bool>> cases{
        {"check-windows-cmd: ok (skipped: the cmd-only run_shell witness drives cmd.exe and runs on Windows only)", true},
        {"check-caps: ok (skipped (not on this platform: the cap witness drives the POSIX serve))", true},
        {"check-plain: ok (wall 1.2 s)", false},
        {"check-broken: failed (skipped: no input)", false},
        {"", false}};
    for (const auto& [output, stub] : cases) {
        if (phase_b_output_is_stub(output) != stub) result.failures.push_back("the stub classification of \"" + output + "\" is not " + (stub ? "true" : "false"));
    }
    const CheckResult cmd = check_witness_windows_cmd(binary);
    const std::string row = "check-witness-windows-cmd: ok (" + cmd.summary + ")";
    if (!phase_b_output_is_stub(row)) result.failures.push_back("the Windows-only stub on this platform is not classed as a stub: " + row);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
    result.summary = "phase-b classes 5 sample rows and the real Windows-only stub as stubs, not as passes (" + std::to_string(cases.size() + 1) + " rows, wall " + std::to_string(wall) + " s)";
    return result;
}

}
