#pragma once

#include <cstddef>
#include <optional>
#include <string>

namespace gm::verbs {

struct Condensed {
    std::string output;
    std::size_t original_chars;
    std::size_t kept_chars;
    std::size_t dropped_lines;
};

std::optional<Condensed> condense_output(const std::string& text);

}
