#include "gm/proc.hpp"
#include "gm/tool.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

namespace gm::tool {
namespace {

constexpr const char* kHeader =
    "procs -----------memory---------- ---swap-- -----io---- -system-- -------cpu-------\n"
    " r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st\n";
constexpr const char* kBusyLine = " 1  0   2048 102400   8000 500000 2404 35608    10    20  300  500  3  2 90  5  0\n";
constexpr const char* kClockChecks = "native/components/tool/checks/clock_mutations.cpp";
constexpr const char* kClosedReport = "closed.err = \"the swap gate stayed closed";

}

CheckResult check_swap_gate(const std::string&) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const std::string busy = std::string(kHeader) + kBusyLine;
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
#if defined(__linux__)
    {
        namespace fs = std::filesystem;
        std::error_code ec;
        const fs::path dir = fs::temp_directory_path() / ("gm-swap-gate-" + std::to_string(started.time_since_epoch().count()));
        fs::create_directories(dir, ec);
        const fs::path fake = dir / "vmstat";
        std::ofstream(fake) << "#!/bin/sh\ncat <<'GMEOF'\n" << busy << "GMEOF\n";
        fs::permissions(fake, fs::perms::owner_all, fs::perm_options::replace, ec);
        const char* old_path = std::getenv("PATH");
        const std::string old = old_path ? old_path : "";
        setenv("PATH", (dir.string() + ":" + old).c_str(), 1);
        const proc::Outcome sample = proc::run({"vmstat", "1", "2"}, {}, {}, 15000);
        const bool fake_ran = sample.started && sample.exit_code == 0 && sample.out.find("2404") != std::string::npos;
        const bool gate_open = proc::wait_for_gate(0);
        if (old_path) setenv("PATH", old.c_str(), 1); else unsetenv("PATH");
        fs::remove_all(dir, ec);
        if (!fake_ran) result.failures.push_back("the fake vmstat on PATH did not run, so the gate wait was not tested");
        if (gate_open) result.failures.push_back("wait_for_gate reported open for a closed reading (2404 KB/s in, 35608 KB/s out)");
    }
#endif
    std::ifstream clock(kClockChecks);
    if (!clock) {
        result.failures.push_back(std::string(kClockChecks) + " is not at this path; run from the checkout root");
    } else {
        std::stringstream clock_text;
        clock_text << clock.rdbuf();
        if (clock_text.str().find(kClosedReport) == std::string::npos) result.failures.push_back("clock_mutations does not report a closed swap gate as the rebuild's error");
    }
    const auto wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "vmstat columns si and so are read from the data line; a reading is open only when both are below 1000 KB/s, a header or empty output is refused, wait_for_gate refuses a closed reading from a fake vmstat on PATH, and clock_mutations reports a closed gate as the rebuild's error (wall " + std::to_string(wall) + " s)";
    return result;
}

}
