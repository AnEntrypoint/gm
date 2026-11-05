#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>

#include "deoxidene/result.hpp"
#include "gm/json.hpp"
#include "gm/verbs.hpp"

namespace gm {

deoxidene::Result<json::Value, std::string> run_body(VerbTable& verbs, std::string_view body,
                                                     const std::filesystem::path& project_root, std::string_view format = "cjs");

}
