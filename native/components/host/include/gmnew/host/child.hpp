#pragma once

#include <filesystem>

#include "gmnew/proc.hpp"

namespace gmnew::host {

using Child = proc::Child;

std::filesystem::path current_executable();

}
