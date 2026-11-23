#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <system_error>

namespace gm::tool {
using namespace support;
namespace {

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;
constexpr long long kInstallLimitMs = 300000;

std::string bytes_of(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

void stage_build(const fs::path& host, const fs::path& local) {
    const fs::path target = local / "native" / "components" / "host";
    fs::create_directories(target);
    fs::copy_file(host / "gm", target / "gm", fs::copy_options::overwrite_existing);
    fs::copy_file(host / "gm-core", target / "gm-core", fs::copy_options::overwrite_existing);
    fs::copy(host / "skills", target / "skills", fs::copy_options::recursive | fs::copy_options::overwrite_existing);
}

void append_probe(const fs::path& file) {
    std::ofstream out(file, std::ios::binary | std::ios::app);
    out << "gm-build-id-probe";
}

struct Scratch {
    fs::path path;
    ~Scratch() {
        std::error_code ignored;
        fs::remove_all(path, ignored);
    }
};

}

CheckResult check_install_build_id(const std::string& binary) {
    CheckResult result;
#if !defined(__linux__)
    result.summary = "skipped (not on this platform: the check copies the build's binaries and installs them with HOME set)";
    return result;
#else
    const auto started = Clock::now();
    const fs::path repo = checkout_root();
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const fs::path host = fs::path(binary).parent_path();
    const Scratch scratch{fs::temp_directory_path() / ("gm-install-build-id-" + std::to_string(started.time_since_epoch().count()))};
    const fs::path home = scratch.path / "home";
    const fs::path first = scratch.path / "first";
    const fs::path second = scratch.path / "second";
    fs::create_directories(home);
    stage_build(host, first);
    stage_build(host, second);
    const fs::path second_host = second / "native" / "components" / "host";
    append_probe(second_host / "gm");
    append_probe(second_host / "gm-core");

    const auto install = [&](const fs::path& local) {
        return proc::run(support::install_argv(home, binary, local, repo), repo, {}, kInstallLimitMs);
    };
    const auto one = install(first);
    if (!one.started || one.exit_code != 0) {
        result.failures.push_back("gm install --local of the first build failed: " + support::failure_text(one));
        return result;
    }
    const fs::path current = home / ".gmnew" / "current";
    const std::string first_link = fs::read_symlink(current).string();
    const auto two = install(second);
    if (!two.started || two.exit_code != 0) {
        result.failures.push_back("gm install --local of the second build failed: " + support::failure_text(two));
        return result;
    }
    if (bytes_of(current / "gm") != bytes_of(second_host / "gm")) result.failures.push_back("the install kept the first build's gm after a second build with the same stamp: " + two.out.substr(0, 200));
    if (bytes_of(current / "gm-core") != bytes_of(second_host / "gm-core")) result.failures.push_back("the install kept the first build's gm-core after a second build with the same stamp");
    if (two.out.find("the build is unchanged") != std::string::npos) result.failures.push_back("the second install reported the build unchanged: " + two.out.substr(0, 200));
    if (fs::read_symlink(current).string() != first_link) result.failures.push_back("the install moved current away from " + first_link);
    const double wall = std::chrono::duration<double>(Clock::now() - started).count();
    if (result.failures.empty()) result.summary = "a second build with the same stamp and different binaries replaced the install (" + first_link + ", wall " + std::to_string(wall) + " s)";
    return result;
#endif
}

}
