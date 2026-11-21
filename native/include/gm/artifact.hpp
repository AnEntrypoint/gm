#pragma once

#include <cstdint>
#include <cstdio>
#include <regex>
#include <string>
#include <utility>
#include <vector>

namespace gm {

inline std::string fnv1a_hex(const std::string& text) {
    std::uint64_t hash = 14695981039346656037ull;
    for (const unsigned char c : text) {
        hash ^= c;
        hash *= 1099511628211ull;
    }
    char out[17];
    std::snprintf(out, sizeof(out), "%016llx", static_cast<unsigned long long>(hash));
    return std::string(out);
}

inline std::string redact_secrets(std::string text) {
    static const std::vector<std::pair<std::regex, std::string>> patterns = {
        {std::regex(R"(Bearer\s+[^\s]+)", std::regex::icase), "Bearer [redacted]"},
        {std::regex(R"(access_token=[^\s&]+)", std::regex::icase), "access_token=[redacted]"},
        {std::regex(R"(refresh_token=[^\s&]+)", std::regex::icase), "refresh_token=[redacted]"},
        {std::regex(R"(api_key=[^\s&]+)", std::regex::icase), "api_key=[redacted]"},
        {std::regex(R"(password=[^\s&]+)", std::regex::icase), "password=[redacted]"},
    };
    for (const auto& [pattern, replacement] : patterns) text = std::regex_replace(text, pattern, replacement);
    return text;
}

}
