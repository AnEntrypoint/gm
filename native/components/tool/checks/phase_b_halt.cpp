#include "gm/phase_b_halt.hpp"
#include "gm/tool.hpp"

#include <chrono>
#include <string>
#include <tuple>
#include <vector>

namespace gm::tool {

CheckResult check_phase_b_halt(const std::string&) {
    CheckResult result;
    const auto began = std::chrono::steady_clock::now();
    const std::vector<std::tuple<bool, bool, int, bool>> cases{
        {true, false, 0, false},
        {true, false, 1, false},
        {true, false, 2, true},
        {true, true, 2, false},
        {false, false, 2, false}};
    for (const auto& [started, timed_out, exit_code, error] : cases) {
        if (phase_b_exit_is_error(started, timed_out, exit_code) != error)
            result.failures.push_back("the error classification of exit " + std::to_string(exit_code) + " (started " + (started ? "yes" : "no") + ", timed out " + (timed_out ? "yes" : "no") + ") is not " + (error ? "true" : "false"));
    }
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
    result.summary = "phase-b halts only on exit 2 of a started, untimed row: 5 exit cases classed (wall " + std::to_string(wall) + " s)";
    return result;
}

}
