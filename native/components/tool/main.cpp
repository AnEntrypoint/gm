#include "gm/tool.hpp"

#include <cstdio>
#include <filesystem>
#include <string>
#include <vector>

namespace {

int usage() {
    std::fputs("usage: gm-tool check <gm binary> [check name ...]\n", stderr);
    return 2;
}

bool selected(const std::vector<std::string>& names, const std::string& name) {
    if (names.empty()) return true;
    for (const auto& wanted : names)
        if (wanted == name) return true;
    return false;
}

}

int main(int argc, char** argv) {
    const std::vector<std::string> args(argv + 1, argv + argc);
    if (args.size() < 2 || args[0] != "check") return usage();
    const std::string binary = std::filesystem::absolute(args[1]).string();
    const std::vector<std::string> names(args.begin() + 2, args.end());
    int status = 0;
    int ran = 0;
    for (const auto& check : gm::tool::checks()) {
        if (!selected(names, check.name)) continue;
        ++ran;
        const auto result = check.run(binary);
        if (result.failures.empty()) {
            std::printf("%s: ok (%s)\n", check.name.c_str(), result.summary.c_str());
            continue;
        }
        status = 1;
        std::printf("%s: %zu failure(s)\n", check.name.c_str(), result.failures.size());
        for (const auto& failure : result.failures) std::printf("- %s\n", failure.c_str());
    }
    if (ran == 0) {
        std::fputs("gm-tool: no check matched\n", stderr);
        return 2;
    }
    return status;
}
