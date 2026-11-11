#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "gm/mcpclient.hpp"

namespace gm::mcpclient {

struct ServerSpec {
    std::string name;
    std::string command;
    std::vector<std::string> args;
    std::vector<std::pair<std::string, std::string>> env;
    std::filesystem::path cwd;
    std::filesystem::path workspace;
    std::uint64_t timeout_ms = 0;
    std::uint64_t startup_ms = 0;
    bool startup_default = false;
    bool lazy = false;
    std::vector<std::string> deny;
    std::vector<std::string> ignore;
};

struct ConfigReading {
    std::vector<ServerSpec> servers;
    std::vector<std::string> problems;
};

ConfigReading read_servers(const std::vector<ConfigFile>& files, const std::filesystem::path& workspace);

}
