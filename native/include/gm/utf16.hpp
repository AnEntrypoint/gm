#pragma once

#include <cstddef>
#include <string_view>

namespace gm {

inline std::size_t utf16_length(std::string_view utf8) {
    std::size_t units = 0;
    for (unsigned char c : utf8) {
        if ((c & 0xC0) != 0x80) units += 1;
        if ((c & 0xF8) == 0xF0) units += 1;
    }
    return units;
}

}
