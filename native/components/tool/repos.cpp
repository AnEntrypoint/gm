#include "gm/tool.hpp"

#include <cstdio>
#include <string>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

const std::vector<std::string> kRepos{"/workspace/gm", "/workspace/fx", "/workspace/jayzee", "/workspace/thebird", "/workspace/hy4-relay", "/workspace/hyperagent"};

long long entries_of(const std::string& text) {
    long long count = 0;
    for (char c : text) {
        if (c == '\n') ++count;
    }
    return count;
}

}

int repos_command(bool strict) {
    int status = 0;
    for (const std::string& path : kRepos) {
        const fs::path repo(path);
        const auto porcelain = git_output(repo, {"status", "--porcelain"});
        if (!porcelain) {
            std::printf("repos: %s absent or not a git repo\n", path.c_str());
            continue;
        }
        const long long dirty = entries_of(*porcelain);
        const auto ahead_text = git_output(repo, {"rev-list", "--count", "@{u}..HEAD"});
        if (!ahead_text) {
            std::printf("repos: %s blocked: %lld uncommitted, no upstream to push to\n", path.c_str(), dirty);
            if (strict && path == kRepos.front()) status = 1;
            continue;
        }
        const long long ahead = std::stoll(*ahead_text);
        if (dirty == 0 && ahead == 0) {
            std::printf("repos: %s clean\n", path.c_str());
            continue;
        }
        std::printf("repos: %s blocked: %lld uncommitted, %lld ahead of origin\n", path.c_str(), dirty, ahead);
        if (strict && path == kRepos.front()) status = 1;
    }
    return status;
}

}
