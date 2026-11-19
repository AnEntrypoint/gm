#include "gm/proc.hpp"

#include <chrono>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <vector>

namespace gm::proc {
namespace {

constexpr long long kSwapLimitKbps = 1000;
constexpr std::uint64_t kSampleTimeoutMs = 15000;
constexpr std::chrono::seconds kPollInterval{5};

#if defined(__linux__)
bool load_below_cores() {
    std::ifstream loadavg("/proc/loadavg");
    double one_minute = 0;
    loadavg >> one_minute;
    const unsigned cores = std::thread::hardware_concurrency();
    return !loadavg.fail() && cores > 0 && one_minute < static_cast<double>(cores);
}
#endif

}

std::optional<SwapSample> parse_vmstat(const std::string& text) {
    std::istringstream lines(text);
    std::string line;
    std::string last;
    while (std::getline(lines, line)) {
        if (!line.empty()) last = line;
    }
    std::istringstream fields(last);
    std::vector<std::string> columns;
    for (std::string column; fields >> column;) columns.push_back(column);
    if (columns.size() < 8) return std::nullopt;
    try {
        return SwapSample{std::stoll(columns[6]), std::stoll(columns[7])};
    } catch (const std::logic_error&) {
        return std::nullopt;
    }
}

bool swap_gate_open(const SwapSample& sample) {
    return sample.in < kSwapLimitKbps && sample.out < kSwapLimitKbps;
}

bool wait_for_gate(std::uint64_t limit_ms) {
#if defined(__linux__)
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(limit_ms);
    for (;;) {
        const Outcome sample = run({"vmstat", "1", "2"}, {}, {}, kSampleTimeoutMs);
        std::optional<SwapSample> reading;
        if (sample.started && sample.exit_code == 0) reading = parse_vmstat(sample.out);
        if (reading && swap_gate_open(*reading) && load_below_cores()) return true;
        if (std::chrono::steady_clock::now() >= deadline) return false;
        std::this_thread::sleep_for(kPollInterval);
    }
#else
    static_cast<void>(limit_ms);
    return true;
#endif
}

}
