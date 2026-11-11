#pragma once

#include <cstdlib>

namespace gm {

inline double clock_scale() {
    static const double scale = [] {
        const char* text = std::getenv("GM_CLOCK_SCALE");
        const double value = text == nullptr ? 1.0 : std::atof(text);
        return value > 0 ? value : 1.0;
    }();
    return scale;
}

}
