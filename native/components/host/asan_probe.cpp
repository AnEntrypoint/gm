#include "gm/host/asan_probe.hpp"

#include <cstdlib>
#include <cstring>

#if defined(__SANITIZE_ADDRESS__)
#include <csignal>
#include <cstdio>
#include <unistd.h>

extern "C" {
std::size_t __sanitizer_get_current_allocated_bytes(void);
std::size_t __sanitizer_get_heap_size(void);
}

namespace gm::host {
namespace {

void report_heap(int) {
    char line[96];
    const int size = std::snprintf(line, sizeof line, "asan-heap live %zu heap %zu\n", __sanitizer_get_current_allocated_bytes(), __sanitizer_get_heap_size());
    if (size > 0) (void)!write(2, line, static_cast<std::size_t>(size));
}

}

void install_asan_probe() {
    const char* enabled = std::getenv("GMNEW_ASAN_PROBE");
    if (enabled == nullptr || std::strcmp(enabled, "1") != 0) return;
    std::signal(SIGUSR2, report_heap);
}

}
#else
namespace gm::host {

void install_asan_probe() {}

}
#endif
