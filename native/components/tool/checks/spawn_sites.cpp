#include "gm/tool.hpp"

#include <fstream>
#include <map>
#include <regex>
#include <set>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

const std::regex kCreation(R"(\b(CreateProcess[AW]|posix_spawnp?|execv[a-z]*|execl[a-z]*|fork|system|popen|_popen|ShellExecute[A-Za-z]*|WinExec)\s*\()");

const std::map<std::string, std::set<std::string>> kAllowed{
    {"native/components/proc/child.cpp", {"CreateProcessW", "posix_spawnp"}},
    {"native/components/proc/proc.cpp", {"CreateProcessA", "posix_spawnp"}},
    {"native/components/verbs/job.cpp", {"CreateProcessW", "posix_spawn"}},
    {"native/components/host/relay.cpp", {"execv"}},
};

bool skipped(const std::string& rel) { return rel.find("third_party/") != std::string::npos || rel.find("vendor/") != std::string::npos; }

std::string checkout_of(const fs::path& start) {
    const auto top = git_output(start, {"rev-parse", "--show-toplevel"});
    std::string text = top.value_or(start.string());
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

}

CheckResult check_spawn_sites(const std::string&) {
    CheckResult result;
    const fs::path root = checkout_of(fs::current_path());
    std::size_t scanned = 0;
    std::size_t creations = 0;
    std::error_code ec;
    for (fs::recursive_directory_iterator it(root / "native", ec), end; !ec && it != end; it.increment(ec)) {
        const auto& path = it->path();
        if (!it->is_regular_file(ec)) continue;
        const auto ext = path.extension().string();
        if (ext != ".cpp" && ext != ".hpp" && ext != ".h" && ext != ".cc") continue;
        const std::string rel = path.lexically_relative(root).generic_string();
        if (skipped(rel)) continue;
        ++scanned;
        std::ifstream in(path);
        std::vector<std::string> lines;
        for (std::string line; std::getline(in, line);) lines.push_back(line);
        for (std::size_t i = 0; i < lines.size(); ++i) {
            std::smatch match;
            std::string rest = lines[i];
            while (std::regex_search(rest, match, kCreation)) {
                const std::string token = match[1].str();
                rest = match.suffix().str();
                ++creations;
                const auto allowed = kAllowed.find(rel);
                const bool ok = allowed != kAllowed.end() && allowed->second.contains(token);
                if (!ok) {
                    result.failures.push_back(rel + ":" + std::to_string(i + 1) + ": " + token + " creates a process outside the creation sites");
                    continue;
                }
                if (!token.starts_with("CreateProcess")) continue;
                bool flagged = false;
                for (std::size_t j = i >= 12 ? i - 12 : 0; j < lines.size() && j <= i + 3 && !flagged; ++j)
                    flagged = lines[j].find("hidden_creation_flags(") != std::string::npos;
                if (!flagged) result.failures.push_back(rel + ":" + std::to_string(i + 1) + ": " + token + " is not created through hidden_creation_flags");
            }
        }
    }
    if (ec) result.failures.push_back("cannot read " + (root / "native").string() + ": " + ec.message());
    result.summary = std::to_string(creations) + " process creation calls in " + std::to_string(scanned) +
                     " files, all in the four creation sites, each Windows one through hidden_creation_flags";
    return result;
}

}
