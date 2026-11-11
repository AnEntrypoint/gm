#pragma once

#include <cstdlib>
#include <string_view>

namespace gm {

inline double clock_scale() {
    static const double scale = [] {
        const char* enabled = std::getenv("GMNEW_TEST_CLOCK");
        const char* text = std::getenv("GM_CLOCK_SCALE");
        if (enabled == nullptr || std::string_view(enabled) != "1" || text == nullptr) return 1.0;
        const double value = std::atof(text);
        return value > 0 && value <= 1 ? value : 1.0;
    }();
    return scale;
}

}
