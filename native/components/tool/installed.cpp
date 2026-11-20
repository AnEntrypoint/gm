#include "gm/tool.hpp"
#include "gm/file.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

std::string trimmed(std::string text) {
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r' || text.back() == ' ')) text.pop_back();
    return text;
}

std::vector<fs::path> files_under(const fs::path& dir) {
    std::vector<fs::path> files;
    std::error_code ec;
    for (const auto& entry : fs::recursive_directory_iterator(dir, ec)) {
        if (entry.is_regular_file(ec)) files.push_back(fs::relative(entry.path(), dir));
    }
    std::sort(files.begin(), files.end());
    return files;
}

}

std::vector<std::string> install_differences(const std::filesystem::path& root, const std::filesystem::path& current) {
    std::string trees;
    for (const char* dir : {"native", "defaults"}) {
        trees += trimmed(git_output(root, {"rev-parse", std::string("HEAD:") + dir}).value_or(std::string()));
    }
    const auto hashed = proc::run({"sha256sum"}, root, trees, 30000);
    const std::string tree_hash = hashed.out.substr(0, 12);
    const std::string expected = tree_hash + "-dev";
    const auto version = proc::run({(current / "gm").string(), "--version"}, root, {}, 30000);
    std::istringstream words(version.out);
    std::string live;
    std::string tree;
    words >> live >> tree;
    std::vector<std::string> stale;
    if (live != expected && tree != "(" + tree_hash + ")") stale.push_back("installed gm reports \"" + live + "\", the checkout's native tree is \"" + expected + "\"");
    const auto checkout_files = files_under(root / "skills");
    if (files_under(current / "skills") != checkout_files) stale.push_back("the installed skill files differ from the checkout's");
    for (const fs::path& file : checkout_files) {
        if (gm::read_binary(current / "skills" / file) != gm::read_binary(root / "skills" / file)) stale.push_back("installed skills/" + file.string() + " is not the checkout's");
    }
    return stale;
}

int installed_command(const std::filesystem::path& root) {
    const char* home = std::getenv("HOME");
    const fs::path current = fs::path(home != nullptr ? home : "") / ".gmnew" / "current";
    const std::vector<std::string> stale = install_differences(root, current);
    const auto version = proc::run({(current / "gm").string(), "--version"}, root, {}, 30000);
    std::istringstream words(version.out);
    std::string live;
    words >> live;
    if (!stale.empty()) {
        std::printf("check-installed: stale install, %zu difference(s)\n", stale.size());
        for (const auto& text : stale) std::printf("- %s\n", text.c_str());
        return 1;
    }
    std::printf("check-installed: ok (the installed build %s and its skills equal the validated build and the checkout)\n", live.c_str());
    return 0;
}

CheckResult check_installed_stamp(const std::string& binary) {
    CheckResult result;
    fs::path root;
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) {
            root = dir;
            break;
        }
        if (dir == dir.parent_path()) break;
    }
    if (root.empty()) {
        result.failures.push_back("no gm checkout above " + fs::current_path().string());
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-installed-stamp-" + std::to_string(stamp));
    const fs::path current = sandbox / "current";
    std::error_code ec;
    fs::create_directories(current, ec);
    fs::copy_file(binary, current / "gm", fs::copy_options::overwrite_existing, ec);
    fs::permissions(current / "gm", fs::perms::owner_all, fs::perm_options::add, ec);
    fs::copy(root / "skills", current / "skills", fs::copy_options::recursive, ec);
    const std::vector<std::string> stale = install_differences(root, current);
    for (const auto& text : stale) result.failures.push_back(text);
    result.summary = "an install holding " + binary + " and the checkout's skills is current: its gm --version tree hash equals the checkout's native and defaults tree, whatever its version name";
    fs::remove_all(sandbox, ec);
    return result;
}

}
