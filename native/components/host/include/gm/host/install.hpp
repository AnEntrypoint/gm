#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include "gm/host/options.hpp"

namespace gm::host {

std::optional<std::filesystem::path> claude_config_path();
std::optional<std::string> register_mcp_server(const std::filesystem::path& config, const std::string& name,
                                               const std::string& command, const std::vector<std::string>& args);
int run_install_command(const HostArgs& args);
int run_uninstall_command(const HostArgs& args);

}
