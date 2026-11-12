#include "gm/tool.hpp"

#include <cstdio>
#include <string>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

long long entries_of(const std::string& text) {
    long long count = 0;
    for (char c : text) {
        if (c == '\n') ++count;
    }
    return count;
}

}

int repos_command(const std::filesystem::path& root, bool strict) {
    const std::string path = root.string();
    const auto porcelain = git_output(root, {"status", "--porcelain"});
    if (!porcelain) {
        std::printf("repos: %s absent or not a git repo\n", path.c_str());
        return strict ? 1 : 0;
    }
    const long long dirty = entries_of(*porcelain);
    const auto ahead_text = git_output(root, {"rev-list", "--count", "@{u}..HEAD"});
    if (!ahead_text) {
        std::printf("repos: %s blocked: %lld uncommitted, no upstream to push to\n", path.c_str(), dirty);
        return strict ? 1 : 0;
    }
    const long long ahead = std::stoll(*ahead_text);
    if (dirty == 0 && ahead == 0) {
        std::printf("repos: %s clean\n", path.c_str());
        return 0;
    }
    std::printf("repos: %s blocked: %lld uncommitted, %lld ahead of origin\n", path.c_str(), dirty, ahead);
    return strict ? 1 : 0;
}

}
