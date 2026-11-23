#include "gm/tool.hpp"
#include "support.hpp"

#include <cmath>
#include <map>
#include <set>
#include <sstream>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

constexpr double kSetupSeconds = 240;
constexpr double kHeadroom = 1.6;
constexpr double kBalanceShare = 0.1;

std::vector<std::string> words(const std::string& text) {
    std::istringstream in(text);
    std::vector<std::string> out;
    for (std::string word; in >> word;) out.push_back(word);
    return out;
}

}

CheckResult check_asan_shards(const std::string&) {
    CheckResult result;
    const fs::path root = checkout_root();
    const std::string shards_text = read_text(root / ".github" / "asan-checks.txt");
    const std::string workflow = read_text(root / ".github" / "workflows" / "arm-diagnose.yml");
    const std::string registry = read_text(root / "native" / "include" / "gm" / "checks.def");
    if (shards_text.empty() || workflow.empty() || registry.empty()) {
        result.failures.push_back("cannot read .github/asan-checks.txt, .github/workflows/arm-diagnose.yml or native/include/gm/checks.def under " + root.string());
        return result;
    }
    std::set<std::string> registered;
    for (std::size_t at = registry.find("CHECK(\""); at != std::string::npos; at = registry.find("CHECK(\"", at + 1)) registered.insert(registry.substr(at + 7, registry.find('"', at + 7) - at - 7));

    const std::string marker = "inputs.checks || '";
    const std::size_t literal = workflow.find(marker);
    if (literal == std::string::npos) {
        result.failures.push_back("arm-diagnose.yml has no asan-arm check list (inputs.checks || '...')");
        return result;
    }
    const std::string list = workflow.substr(literal + marker.size(), workflow.find('\'', literal + marker.size()) - literal - marker.size());
    std::set<std::string> universe;
    for (const std::string& name : words(list)) universe.insert(name);

    std::map<std::string, int> shard_of;
    std::map<int, double> seconds;
    std::istringstream lines(shards_text);
    for (std::string line; std::getline(lines, line);) {
        const auto fields = words(line);
        if (fields.empty()) continue;
        if (fields.size() != 3) {
            result.failures.push_back("a line of asan-checks.txt is not '<shard> <check> <seconds>': " + line);
            continue;
        }
        const int shard = std::atoi(fields[0].c_str());
        if (shard != 1 && shard != 2) result.failures.push_back(fields[1] + " is in shard " + fields[0] + ", not 1 or 2");
        if (shard_of.count(fields[1]) != 0) result.failures.push_back(fields[1] + " is in asan-checks.txt twice (shards " + std::to_string(shard_of[fields[1]]) + " and " + fields[0] + "), so it would run twice");
        shard_of[fields[1]] = shard;
        seconds[shard] += std::atof(fields[2].c_str());
        if (registered.count(fields[1]) == 0) result.failures.push_back(fields[1] + " in asan-checks.txt is not a registered check");
    }
    for (const std::string& name : universe)
        if (shard_of.count(name) == 0) result.failures.push_back(name + " runs in the asan-arm job but in neither stackuse shard");
    for (const auto& [name, shard] : shard_of)
        if (universe.count(name) == 0) result.failures.push_back(name + " is in stackuse shard " + std::to_string(shard) + " but not in the asan-arm list, so the two jobs would not run the same checks");

    const double total = seconds[1] + seconds[2];
    if (total > 0 && std::fabs(seconds[1] - seconds[2]) > kBalanceShare * total)
        result.failures.push_back("the shards are unbalanced by their recorded seconds: " + std::to_string(static_cast<long long>(seconds[1])) + " against " + std::to_string(static_cast<long long>(seconds[2])) + " of " + std::to_string(static_cast<long long>(total)));

    const std::size_t job = workflow.find("asan-arm-stackuse:");
    const std::string block = job == std::string::npos ? std::string() : workflow.substr(job, workflow.find("\n  gdb-arm:", job) - job);
    if (block.find(".github/asan-checks.txt") == std::string::npos || block.find("matrix.shard") == std::string::npos) result.failures.push_back("the stackuse job does not select its checks from .github/asan-checks.txt by matrix.shard");
    if (block.find("inputs.checks ||") != std::string::npos) result.failures.push_back("the stackuse job carries its own check list; it must read asan-checks.txt");
    const std::size_t timeout_at = block.find("timeout-minutes:");
    const double timeout_minutes = timeout_at == std::string::npos ? 0 : std::atof(block.c_str() + timeout_at + 16);
    const double slowest = std::max(seconds[1], seconds[2]);
    const double needed = kHeadroom * (kSetupSeconds + slowest) / 60;
    if (timeout_minutes < needed) result.failures.push_back("the stackuse job's timeout of " + std::to_string(static_cast<long long>(timeout_minutes)) + " minutes is below " + std::to_string(static_cast<long long>(std::ceil(needed))) + ": " + std::to_string(kHeadroom).substr(0, 3) + " times its setup of " + std::to_string(static_cast<long long>(kSetupSeconds)) + " s plus its slowest shard of " + std::to_string(static_cast<long long>(slowest)) + " s");

    result.summary = std::to_string(shard_of.size()) + " checks, each in one of two stackuse shards and all of the asan-arm list (" + std::to_string(universe.size()) + "), shards of " + std::to_string(static_cast<long long>(seconds[1])) + " s and " + std::to_string(static_cast<long long>(seconds[2])) + " s recorded, a timeout of " + std::to_string(static_cast<long long>(timeout_minutes)) + " minutes against " + std::to_string(static_cast<long long>(std::ceil(needed))) + " needed";
    return result;
}

}
