#include "gm/tool.hpp"

namespace gm::tool {

const std::vector<Registered>& checks() {
    static const std::vector<Registered> all{
#define CHECK(name, fn) {name, fn},
#include "gm/checks.def"
#undef CHECK
    };
    return all;
}

}
