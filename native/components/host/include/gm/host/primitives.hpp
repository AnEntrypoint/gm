#pragma once

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <cstdint>
#include <string>
#include <string_view>

#include "gm/host.hpp"
#include "gm/log.hpp"

namespace gm::host {

using CurrentLog = std::function<std::shared_ptr<RunLog>()>;
using LeafAppended = std::function<void(const RunLog&, std::string_view, std::uint64_t)>;

std::map<std::string, Primitive> make_primitives(std::filesystem::path workspace, CurrentLog current_log, LeafAppended leaf_appended = {});

}
