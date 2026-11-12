#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include "gm/host/options.hpp"

namespace gm::host {

int run_install_command(const HostArgs& args);
int run_uninstall_command(const HostArgs& args);

}
