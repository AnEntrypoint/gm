#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "gm/json.hpp"

namespace gm {

struct VerbInfo {
    std::string name;
    std::string description;
    std::string input_schema_json;
};

class VerbTable {
public:
    virtual ~VerbTable() = default;
    virtual std::vector<VerbInfo> list() const = 0;
    virtual json::Value call(std::string_view name, const json::Value& args) = 0;
    virtual json::Value call_sibling(std::string_view sibling, std::string_view tool, const json::Value& args) {
        (void)sibling;
        (void)args;
        json::Value reply;
        reply.set("ok", false).set("error", "unknown tool: " + std::string(tool));
        return reply;
    }
};

}
