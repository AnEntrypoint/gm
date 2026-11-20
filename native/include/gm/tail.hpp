#pragma once

#include <cstddef>
#include <string_view>

namespace gm {

inline std::size_t tail_lines_start(std::string_view text, std::size_t lines) {
    if (lines == 0) return text.size();
    std::size_t end = text.size();
    if (end > 0 && text[end - 1] == '\n') end -= 1;
    for (std::size_t at = end; at > 0; --at) {
        if (text[at - 1] == '\n' && --lines == 0) return at;
    }
    return 0;
}

}
