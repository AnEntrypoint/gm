#pragma once

#include <filesystem>

#include "gm/proc.hpp"

namespace gm::host {

using Child = proc::Child;

std::filesystem::path current_executable();

}
