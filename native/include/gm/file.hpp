#pragma once

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

namespace gm {

inline std::string read_binary(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

}
