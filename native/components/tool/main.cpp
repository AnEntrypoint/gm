#include "gm/tool.hpp"

#include <cstdio>
#include <filesystem>
#include <string>
#include <vector>

namespace {

int usage() {
    std::fputs("usage: gm-tool check <gm binary> [check name ...]\n"
               "       gm-tool gate\n"
               "       gm-tool phase-b [build dir]\n"
               "       gm-tool ship \"<subject>\" <paths...>  |  gm-tool ship --push\n"
               "       gm-tool installed\n",
               stderr);
    return 2;
}

bool selected(const std::vector<std::string>& names, const std::string& name) {
    if (names.empty()) return true;
    for (const auto& wanted : names)
        if (wanted == name) return true;
    return false;
}

std::filesystem::path checkout_root() {
    const auto top = gm::tool::git_output(std::filesystem::current_path(), {"rev-parse", "--show-toplevel"});
    std::string text = top.value_or(std::filesystem::current_path().string());
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return std::filesystem::path(text);
}

int run_checks(const std::vector<std::string>& args) {
    if (args.size() < 2) return usage();
    const std::string binary = std::filesystem::absolute(args[1]).string();
    const std::vector<std::string> names(args.begin() + 2, args.end());
    int status = 0;
    int ran = 0;
    for (const auto& check : gm::tool::checks()) {
        if (!selected(names, check.name)) continue;
        if (names.empty() && check.name == "clock-mutations") continue;
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

}

int main(int argc, char** argv) {
    const std::vector<std::string> args(argv + 1, argv + argc);
    if (args.empty()) return usage();
    const std::string& command = args[0];
    if (command == "check") return run_checks(args);
    const auto root = checkout_root();
    if (command == "gate") return gm::tool::gate_command(root);
    if (command == "phase-b") {
        const auto build = args.size() > 1 ? std::filesystem::path(args[1]) : root / "build" / "release";
        return gm::tool::phase_b_command(root, std::filesystem::absolute(build));
    }
    if (command == "ship") return gm::tool::ship_command(root, std::vector<std::string>(args.begin() + 1, args.end()));
    if (command == "installed") return gm::tool::installed_command(root);
    return usage();
}
