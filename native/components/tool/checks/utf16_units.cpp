#include "gm/tool.hpp"
#include "gm/utf16.hpp"

namespace gm::tool {

CheckResult check_utf16_units(const std::string&) {
    CheckResult result;
    struct Case {
        const char* text;
        std::size_t units;
    };
    const Case cases[] = {{"a", 1}, {"\xc3\xa9", 1}, {"\xe2\x82\xac", 1}, {"\xf0\x9f\x98\x80", 2}, {"a\xf0\x9f\x98\x80z", 4}, {"\xf8", 1}};
    for (const Case& c : cases) {
        const std::size_t got = gm::utf16_length(c.text);
        if (got != c.units) result.failures.push_back("utf16_length of a sample is " + std::to_string(got) + ", expected " + std::to_string(c.units));
    }
    result.summary = "utf16_length counts ASCII, two-byte, three-byte, four-byte (two units) and a stray lead byte (one unit)";
    return result;
}

}
