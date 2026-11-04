#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "gmnew/json.hpp"

namespace gmnew {

struct VerbInfo {
    std::string name;
    std::string description;
    std::string input_schema_json;
};

class VerbTable {
public:
    virtual ~VerbTable() = default;
    virtual std::vector<VerbInfo> list() const = 0;
    // args is a JSON object. The reply is a JSON object; a failed verb replies {"ok": false, "error": "..."}.
    virtual json::Value call(std::string_view name, const json::Value& args) = 0;
};

}  // namespace gmnew
