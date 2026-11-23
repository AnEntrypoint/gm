#include "gm/tool.hpp"

#include <cstdio>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>
#include <vector>

#if defined(_WIN32)
#include <process.h>
#else
#include <unistd.h>
#endif

namespace {

int usage() {
    std::fputs("usage: gm-tool check <gm binary> [check name ...]\n"
               "       gm-tool gate\n"
               "       gm-tool phase-b [build dir]\n"
               "       gm-tool ship \"<subject>\" <paths...>  |  gm-tool ship --push\n"
               "       gm-tool installed\n"
               "       gm-tool package --target <t> --build-dir <dir> --out <dir>\n"
               "       gm-tool release-manifest --dir <dir> --version <v> --commit <sha> --repo <r> [--previous f] [--present f] [--summary f]\n"
               "       gm-tool prune-release-assets [--keep n] < names\n",
               stderr);
    return 2;
}

class ScratchRoot {
public:
    ScratchRoot() {
        std::error_code ec;
        const std::filesystem::path real_temp = std::filesystem::temp_directory_path(ec);
        gm::tool::sweep_dead_scratch(real_temp);
        root_ = real_temp / ("g" + std::to_string(process_id()));
        std::filesystem::create_directories(root_, ec);
        std::ofstream(root_ / gm::tool::kScratchMarker) << process_id() << "\n";
        point_temp_directory_at(root_);
    }

    ~ScratchRoot() {
        std::error_code ec;
        std::filesystem::remove_all(root_, ec);
    }

    ScratchRoot(const ScratchRoot&) = delete;
    ScratchRoot& operator=(const ScratchRoot&) = delete;

private:
    static int process_id() {
#if defined(_WIN32)
        return _getpid();
#else
        return getpid();
#endif
    }

    static void point_temp_directory_at(const std::filesystem::path& root) {
#if defined(_WIN32)
        _putenv_s("TMP", root.string().c_str());
        _putenv_s("TEMP", root.string().c_str());
#else
        setenv("TMPDIR", root.c_str(), 1);
#endif
    }

    std::filesystem::path root_;
};

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
    const ScratchRoot scratch;
    const std::string binary = std::filesystem::absolute(args[1]).string();
    const std::vector<std::string> names(args.begin() + 2, args.end());
    int status = 0;
    int ran = 0;
    for (const auto& check : gm::tool::checks()) {
        if (!selected(names, check.name)) continue;
        if (names.empty() && check.name == "clock-mutations") continue;
        ++ran;
        gm::tool::CheckResult result;
        try {
            result = check.run(binary);
        } catch (const std::exception& error) {
            std::printf("%s: error: %s\n", check.name.c_str(), error.what());
            status = 2;
            continue;
        }
        if (result.failures.empty()) {
            std::printf("%s: ok (%s)\n", check.name.c_str(), result.summary.c_str());
            continue;
        }
        if (status == 0) status = 1;
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
    if (command == "package") return gm::tool::package_command(root, args);
    if (command == "release-manifest") return gm::tool::release_manifest_command(args);
    if (command == "prune-release-assets") return gm::tool::prune_assets_command(args);
    if (command == "repos") return gm::tool::repos_command(root, args.size() > 1 && args[1] == "--strict");
    return usage();
}
