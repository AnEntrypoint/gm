#pragma once

#include <cstdint>
#include <filesystem>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "gmnew/playwriter.hpp"

namespace gmnew::playwriter {

struct ServerSpec {
    std::string name;
    std::string command;
    std::vector<std::string> args;
    std::vector<std::pair<std::string, std::string>> env;
    std::filesystem::path cwd;
    std::uint64_t timeout_ms = 0;
    std::uint64_t startup_ms = 0;
    std::vector<std::string> deny;
    std::vector<std::string> ignore;
};

void warn(const std::string& text);

std::map<std::string, ServerSpec, std::less<>> read_servers(const std::vector<ConfigFile>& files,
                                                            const std::filesystem::path& workspace);

}
