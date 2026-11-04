#pragma once

#include <filesystem>
#include <functional>
#include <map>
#include <string>

#include "gmnew/json.hpp"
#include "gmnew/verbs.hpp"

namespace gmnew {

using Primitive = std::function<json::Value(const json::Value& args)>;

struct HostServices {
    std::filesystem::path workspace;
    std::filesystem::path run_dir;
    VerbTable* native = nullptr;
    std::map<std::string, Primitive> extra;
};

}
