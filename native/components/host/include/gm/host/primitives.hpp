#pragma once

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <string>

#include "gm/host.hpp"
#include "gm/log.hpp"

namespace gm::host {

using CurrentLog = std::function<std::shared_ptr<RunLog>()>;

std::map<std::string, Primitive> make_primitives(std::filesystem::path workspace, CurrentLog current_log);

}
