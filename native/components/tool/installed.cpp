#include "gm/tool.hpp"

#include <algorithm>
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

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
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

int installed_command(const std::filesystem::path& root) {
    std::string trees;
    for (const char* dir : {"native", "defaults"}) {
        trees += trimmed(git_output(root, {"rev-parse", std::string("HEAD:") + dir}).value_or(std::string()));
    }
    const auto hashed = proc::run({"sha256sum"}, root, trees, 30000);
    const std::string expected = hashed.out.substr(0, 12) + "-dev";
    const char* home = std::getenv("HOME");
    const fs::path current = fs::path(home != nullptr ? home : "") / ".gmnew" / "current";
    const auto version = proc::run({(current / "gm").string(), "--version"}, root, {}, 30000);
    std::istringstream words(version.out);
    std::string live;
    words >> live;
    std::vector<std::string> stale;
    if (live != expected) stale.push_back("installed gm reports \"" + live + "\", the checkout's native tree is \"" + expected + "\"");
    const auto checkout_files = files_under(root / "skills");
    if (files_under(current / "skills") != checkout_files) stale.push_back("the installed skill files differ from the checkout's");
    for (const fs::path& file : checkout_files) {
        if (read_text(current / "skills" / file) != read_text(root / "skills" / file)) stale.push_back("installed skills/" + file.string() + " is not the checkout's");
    }
    if (!stale.empty()) {
        std::printf("check-installed: stale install, %zu difference(s)\n", stale.size());
        for (const auto& text : stale) std::printf("- %s\n", text.c_str());
        return 1;
    }
    std::printf("check-installed: ok (the installed build %s and its skills equal the validated build and the checkout)\n", live.c_str());
    return 0;
}

}
