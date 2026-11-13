#include "gm/tool.hpp"

#include <fstream>
#include <string>
#include <vector>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

const std::vector<std::string> kFiles{
    "native/components/tool/checks/browser_first_open.cpp",
    "native/components/tool/checks/lazy_browser.cpp",
    "native/components/tool/checks/browser_scope.cpp"};

std::string checkout_root() {
    const auto top = git_output(fs::current_path(), {"rev-parse", "--show-toplevel"});
    std::string text = top.value_or(fs::current_path().string());
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

bool direct_proc_read(const std::string& line) {
    return line.find("/proc/") != std::string::npos &&
           (line.find("cmdline") != std::string::npos || line.find("environ") != std::string::npos);
}

bool linux_guard_line(const std::string& line) {
    return line.find("#if defined(__linux__)") != std::string::npos;
}

}

CheckResult check_portable_proc_reads(const std::string&) {
    CheckResult result;
    const fs::path root = checkout_root();
    std::size_t scanned = 0;
    for (const std::string& rel : kFiles) {
        std::ifstream in(root / rel);
        if (!in) {
            result.failures.push_back("cannot read " + rel);
            continue;
        }
        bool linux_guard = false;
        std::string line;
        std::size_t number = 0;
        while (std::getline(in, line)) {
            ++number;
            if (linux_guard_line(line)) {
                linux_guard = true;
            } else if (line.find("#else") != std::string::npos && linux_guard) {
                linux_guard = false;
            } else if (line.find("#endif") != std::string::npos) {
                linux_guard = false;
            }
            if (direct_proc_read(line) && !linux_guard) {
                result.failures.push_back(rel + ":" + std::to_string(number) + ": direct /proc cmdline or environ read outside a Linux guard");
            }
        }
        ++scanned;
    }
    result.summary = std::to_string(scanned) + " POSIX check files use portable process helpers";
    return result;
}

}
