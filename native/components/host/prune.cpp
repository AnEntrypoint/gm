#include "gm/host/update.hpp"
#include "gm/proc.hpp"

#include <algorithm>
#include <chrono>
#include <set>
#include <system_error>

#if defined(__linux__)
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace gm::host {
namespace fs = std::filesystem;
namespace {

constexpr const char* kMarker = ".gmnew-update.json";
constexpr const char* kPruningSuffix = ".pruning";

std::string without_deleted(std::string text) {
    const std::string tail = " (deleted)";
    if (text.size() >= tail.size() && text.compare(text.size() - tail.size(), tail.size(), tail) == 0) text.resize(text.size() - tail.size());
    return text;
}

bool under(const std::string& path, const std::string& dir) {
    return !path.empty() && path.size() > dir.size() && path.compare(0, dir.size(), dir) == 0 && path[dir.size()] == '/';
}

bool is_this_users(long long pid) {
#if defined(__linux__)
    struct stat info {};
    return ::stat(("/proc/" + std::to_string(pid)).c_str(), &info) == 0 && info.st_uid == ::geteuid();
#else
    (void)pid;
    return false;
#endif
}

std::uintmax_t size_of(const fs::path& dir) {
    std::uintmax_t bytes = 0;
    std::error_code ec;
    for (fs::recursive_directory_iterator it(dir, fs::directory_options::skip_permission_denied, ec), end; !ec && it != end; it.increment(ec)) {
        std::error_code entry_ec;
        if (it->is_regular_file(entry_ec) && !it->is_symlink(entry_ec)) bytes += it->file_size(entry_ec);
    }
    return bytes;
}

bool ours(const fs::directory_entry& entry) {
    std::error_code ec;
    if (!entry.is_directory(ec) || entry.is_symlink(ec)) return false;
    const std::string name = entry.path().filename().string();
    if (name.size() > std::string(kPruningSuffix).size() && name.compare(name.size() - std::string(kPruningSuffix).size(), std::string::npos, kPruningSuffix) == 0) return true;
    return fs::exists(entry.path() / kMarker, ec);
}

std::string in_use_scan(const fs::path& root, const fs::path& versions, std::set<std::string>& used) {
    std::error_code ec;
    std::vector<std::string> prefixes{versions.string()};
    const std::string canonical_root = fs::weakly_canonical(root, ec).string();
    const std::string canonical = fs::weakly_canonical(versions, ec).string();
    if (!ec && canonical != prefixes[0]) prefixes.push_back(canonical);
    auto note = [&](const std::string& raw) {
        const std::string path = without_deleted(raw);
        for (const std::string& prefix : prefixes) {
            if (!under(path, prefix)) continue;
            const std::string rest = path.substr(prefix.size() + 1);
            used.insert(rest.substr(0, rest.find('/')));
        }
    };
    for (const auto& row : proc::process_table()) {
        if (row.zombie) continue;
        const fs::path exe = proc::process_exe(row.pid);
        if (exe.empty()) {
            if (!is_this_users(row.pid)) continue;
            for (const std::string& argument : proc::command_of(row.pid)) {
                note(argument);
                if (under(argument, (root / "current").string()) || under(argument, canonical_root + "/current") || argument.find((root / "previous-").string()) == 0)
                    return "process " + std::to_string(row.pid) + ", one of this user's, was started through the install links and its executable cannot be read, so the version it runs is unknown";
            }
            continue;
        }
        note(exe.string());
        for (const std::string& argument : proc::command_of(row.pid)) note(argument);
#if defined(__linux__)
        std::error_code cwd_ec;
        const fs::path cwd = fs::read_symlink("/proc/" + std::to_string(row.pid) + "/cwd", cwd_ec);
        if (!cwd_ec) note(cwd.string());
#endif
    }
    return {};
}

}

PruneResult prune_versions(const fs::path& root, const std::string& current, const std::string& previous) {
    PruneResult result;
#if defined(_WIN32)
    result.skipped = "pruning is not done on Windows, where a running executable cannot be told apart from an idle one";
    (void)root;
    (void)current;
    (void)previous;
    return result;
#else
    const fs::path versions = root / "versions";
    std::error_code ec;
    if (!fs::is_directory(versions, ec)) return result;
    std::set<std::string> used;
    result.skipped = in_use_scan(root, versions, used);
    if (!result.skipped.empty()) return result;
    std::vector<fs::path> candidates;
    for (const auto& entry : fs::directory_iterator(versions, ec)) {
        const std::string name = entry.path().filename().string();
        if (name == current || name == previous || !ours(entry)) continue;
        if (used.count(name) != 0) {
            result.in_use.push_back(name);
            continue;
        }
        candidates.push_back(entry.path());
    }
    for (const fs::path& dir : candidates) {
        const std::string name = dir.filename().string();
        const std::uintmax_t bytes = size_of(dir);
        fs::path doomed = dir;
        if (name.size() < std::string(kPruningSuffix).size() || name.compare(name.size() - std::string(kPruningSuffix).size(), std::string::npos, kPruningSuffix) != 0) {
            doomed = versions / (name + kPruningSuffix);
            fs::remove_all(doomed, ec);
            fs::rename(dir, doomed, ec);
            if (ec) {
                result.in_use.push_back(name);
                continue;
            }
        }
        fs::remove_all(doomed, ec);
        if (ec) continue;
        result.removed.push_back(name);
        result.bytes += bytes;
    }
    std::vector<fs::path> stale;
    for (const auto& entry : fs::directory_iterator(root, ec)) {
        const std::string name = entry.path().filename().string();
        if (name.rfind("previous-", 0) != 0 || !entry.is_symlink(ec)) continue;
        const fs::path target = fs::read_symlink(entry.path(), ec);
        if (ec || target.parent_path().filename() != "versions") continue;
        if (!previous.empty() && name == "previous-" + previous && target.filename() == previous) continue;
        stale.push_back(entry.path());
    }
    for (const fs::path& link : stale) fs::remove(link, ec);
    return result;
#endif
}

}
