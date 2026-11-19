#pragma once

#include <algorithm>
#include <cstdint>
#include <limits>

namespace gm {

template <typename Integer>
Integer saturating_cast(double value) {
    if (value <= static_cast<double>(std::numeric_limits<Integer>::min())) return std::numeric_limits<Integer>::min();
    if (value >= static_cast<double>(std::numeric_limits<Integer>::max())) return std::numeric_limits<Integer>::max();
    return static_cast<Integer>(value);
}

inline std::uint64_t timeout_ms_of(double value) {
    constexpr std::uint64_t clock_range_ms = 4000000000000ull;
    return std::min(saturating_cast<std::uint64_t>(value), clock_range_ms);
}

}
