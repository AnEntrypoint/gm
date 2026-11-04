#include "gmnew/host/child.hpp"

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <cstdint>
#include <system_error>
#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif
#endif

namespace gmnew::host {

std::filesystem::path current_executable() {
#if defined(_WIN32)
    wchar_t buffer[32768];
    const DWORD n = GetModuleFileNameW(nullptr, buffer, 32768);
    return n == 0 ? std::filesystem::path{} : std::filesystem::path(std::wstring(buffer, n));
#elif defined(__APPLE__)
    char buffer[4096];
    std::uint32_t size = sizeof buffer;
    if (_NSGetExecutablePath(buffer, &size) == 0) return std::filesystem::weakly_canonical(buffer);
    return {};
#else
    std::error_code ec;
    auto path = std::filesystem::read_symlink("/proc/self/exe", ec);
    return ec ? std::filesystem::path{} : path;
#endif
}

}
