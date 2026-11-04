#pragma once

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <string>

#include "gmnew/host.hpp"
#include "gmnew/log.hpp"

namespace gmnew::host {

using CurrentLog = std::function<std::shared_ptr<RunLog>()>;

std::map<std::string, Primitive> make_primitives(std::filesystem::path workspace, CurrentLog current_log);

}  // namespace gmnew::host
