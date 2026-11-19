#include "gm/proc.hpp"
#include "gm/tool.hpp"

#include <chrono>
#include <string>

namespace gm::tool {
namespace {

constexpr const char* kHeader =
    "procs -----------memory---------- ---swap-- -----io---- -system-- -------cpu-------\n"
    " r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st\n";

}

CheckResult check_swap_gate(const std::string&) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const std::string busy = std::string(kHeader) + " 1  0   2048 102400   8000 500000 2404 35608    10    20  300  500  3  2 90  5  0\n";
    const std::string quiet = std::string(kHeader) + " 1  0   2048 102400   8000 500000   40     0    10    20  300  500  3  2 95  0  0\n";
    const auto busy_reading = proc::parse_vmstat(busy);
    const auto quiet_reading = proc::parse_vmstat(quiet);
    if (!busy_reading || busy_reading->in != 2404 || busy_reading->out != 35608) result.failures.push_back("the busy sample did not parse to si 2404 and so 35608");
    if (!quiet_reading || quiet_reading->in != 40 || quiet_reading->out != 0) result.failures.push_back("the quiet sample did not parse to si 40 and so 0");
    if (busy_reading && proc::swap_gate_open(*busy_reading)) result.failures.push_back("a reading of 2404 KB/s in and 35608 KB/s out was read as open");
    if (quiet_reading && !proc::swap_gate_open(*quiet_reading)) result.failures.push_back("a reading of 40 KB/s in and 0 KB/s out was read as closed");
    if (!proc::swap_gate_open({999, 999})) result.failures.push_back("999 KB/s in both directions was read as closed");
    if (proc::swap_gate_open({1000, 0}) || proc::swap_gate_open({0, 1000})) result.failures.push_back("1000 KB/s was read as open; the limit is exclusive");
    if (proc::parse_vmstat(kHeader)) result.failures.push_back("a header without a data line parsed as a sample");
    if (proc::parse_vmstat("")) result.failures.push_back("an empty output parsed as a sample");
    const auto wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "vmstat columns si and so are read from the data line; a reading is open only when both are below 1000 KB/s, and a header or empty output is refused (wall " + std::to_string(wall) + " s)";
    return result;
}

}
