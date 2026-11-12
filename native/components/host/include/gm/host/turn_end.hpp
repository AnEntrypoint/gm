#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>

#include "gm/host/options.hpp"

namespace gm::host {

int run_turn_end(const HostArgs&);
std::optional<std::int64_t> turn_ended_ms(const std::filesystem::path& workspace);

}
