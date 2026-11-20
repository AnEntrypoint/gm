#include "gm/tool.hpp"
#include "gm/clock.hpp"

#include <chrono>

namespace gm::tool {

CheckResult check_clock_format(const std::string&) {
    CheckResult result;
    const auto at = std::chrono::system_clock::time_point(std::chrono::milliseconds(1700000000123));
    const std::string iso = gm::iso_utc(at);
    if (iso != "2023-11-14T22:13:20.123Z") result.failures.push_back("iso_utc of 1700000000123 ms is " + iso + ", expected 2023-11-14T22:13:20.123Z");
    const std::tm parts = gm::utc_parts(1700000000);
    if (parts.tm_year != 123 || parts.tm_mon != 10 || parts.tm_mday != 14 || parts.tm_hour != 22) result.failures.push_back("utc_parts of 1700000000 is not 2023-11-14 22:00 UTC");
    result.summary = "iso_utc and utc_parts give 2023-11-14T22:13:20.123Z for 1700000000123 ms";
    return result;
}

}
