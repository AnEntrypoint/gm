#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>

#include "deoxidene/result.hpp"
#include "gmnew/json.hpp"
#include "gmnew/verbs.hpp"

namespace gmnew {

// Runs one run_code body in a new QuickJS-NG context. The body is an async function body: top-level await works,
// and its return value comes back as JSON. The global gm has one function per verb in verbs.list(), each taking one
// object and returning a Promise of the verb's reply; gm.try(fn), gm.verbs() and gm.project are also there.
// A throw in the body is an error: the Err text names it.
deoxidene::Result<json::Value, std::string> run_body(VerbTable& verbs, std::string_view body,
                                                     const std::filesystem::path& project_root);

}  // namespace gmnew
