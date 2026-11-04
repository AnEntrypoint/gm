#pragma once

#include <charconv>
#include <cstdint>
#include <memory>
#include <string_view>
#include <system_error>

#include "deoxidene/result.hpp"

namespace deoxidene {

enum class ParseError : std::uint8_t { kEmpty, kNotNumeric, kOverflow };

[[nodiscard]] inline auto parse_positive_int(std::string_view text) -> Result<int, ParseError> {
    if (text.empty()) {
        return Fail<ParseError, int>(ParseError::kEmpty);
    }
    if (text.front() == '-') {
        return Fail<ParseError, int>(ParseError::kNotNumeric);
    }
    const auto first = std::to_address(text.begin());
    const auto last = std::to_address(text.end());
    int value = 0;
    const auto [end, ec] = std::from_chars(first, last, value);
    if (ec == std::errc::result_out_of_range) {
        return Fail<ParseError, int>(ParseError::kOverflow);
    }
    if (ec != std::errc{} || end != last) {
        return Fail<ParseError, int>(ParseError::kNotNumeric);
    }
    return Ok<int, ParseError>(value);
}

}  // namespace deoxidene
