#pragma once

#include <string>
#include <string_view>

#include "deoxidene/result.hpp"

namespace gm {

deoxidene::Result<std::string, std::string> run_query(std::string_view events_json_array, std::string_view js);

}
