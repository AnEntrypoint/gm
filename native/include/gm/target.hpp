#pragma once

#include <array>
#include <string>
#include <string_view>

namespace gm {

inline constexpr std::array<std::string_view, 6> kTargets{"x64-linux", "arm64-linux", "x64-macos", "arm64-macos", "x64-windows", "arm64-windows"};

inline std::string target_key(std::string_view os, std::string_view arch) {
    const std::string key = std::string(arch) + "-" + std::string(os);
    for (const std::string_view target : kTargets) {
        if (target == key) return key;
    }
    return "unknown";
}

inline std::string platform_target() {
#if defined(_WIN32)
    constexpr std::string_view os = "windows";
#elif defined(__APPLE__)
    constexpr std::string_view os = "macos";
#else
    constexpr std::string_view os = "linux";
#endif
#if defined(__x86_64__) || defined(_M_X64)
    constexpr std::string_view arch = "x64";
#elif defined(__aarch64__) || defined(_M_ARM64)
    constexpr std::string_view arch = "arm64";
#else
    constexpr std::string_view arch = "unknown";
#endif
    return target_key(os, arch);
}

}
