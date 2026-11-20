#pragma once

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <string>
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

inline std::tm utc_parts(std::time_t seconds) {
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &seconds);
#else
    gmtime_r(&seconds, &utc);
#endif
    return utc;
}

inline std::string iso_utc(std::chrono::system_clock::time_point at) {
    const auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(at.time_since_epoch()).count() % 1000;
    const std::tm utc = utc_parts(std::chrono::system_clock::to_time_t(at));
    char buf[48];
    std::snprintf(buf, sizeof buf, "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ", utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec, static_cast<long long>(millis));
    return buf;
}

}
