#include "gm/tool.hpp"

namespace gm::tool {

const std::vector<Registered>& checks() {
    static const std::vector<Registered> all{
        {"check-read-after-write", check_read_after_write},
        {"check-spawn-sites", check_spawn_sites},
        {"check-lazy-browser", check_lazy_browser},
        {"check-rows", check_rows},
    };
    return all;
}

}
