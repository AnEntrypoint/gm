#pragma once

#include <string>
#include <vector>

namespace gm {

inline std::vector<std::string> split_lines(const std::string& text) {
    std::vector<std::string> lines;
    std::size_t at = 0;
    while (true) {
        const std::size_t newline = text.find('\n', at);
        lines.push_back(text.substr(at, newline == std::string::npos ? std::string::npos : newline - at));
        if (newline == std::string::npos) break;
        at = newline + 1;
    }
    return lines;
}

}
