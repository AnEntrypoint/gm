#include "gm/tool.hpp"

#include <cctype>
#include <set>
#include <string>
#include <system_error>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

bool all_digits(const std::string& text) {
    if (text.empty()) return false;
    for (const char c : text)
        if (!std::isdigit(static_cast<unsigned char>(c))) return false;
    return true;
}

bool all_hex(const std::string& text) {
    if (text.empty()) return false;
    for (const char c : text)
        if (!std::isxdigit(static_cast<unsigned char>(c))) return false;
    return true;
}

long long scratch_root_pid(const std::string& name) {
    if (name.size() < 2 || name[0] != 'g' || !all_digits(name.substr(1))) return 0;
    return std::stoll(name.substr(1));
}

long long ship_copy_pid(const std::string& name) {
    const std::string prefix = "gm-ship-";
    if (name.compare(0, prefix.size(), prefix) != 0) return 0;
    const std::size_t dash = name.find('-', prefix.size());
    if (dash == std::string::npos || !all_hex(name.substr(prefix.size(), dash - prefix.size())) || !all_digits(name.substr(dash + 1))) return 0;
    return std::stoll(name.substr(dash + 1));
}

}

const char* const kScratchMarker = ".gm-tool-scratch";
const char* const kShipCopyMarkerSuffix = ".gm-ship-copy";

std::size_t sweep_dead_scratch(const fs::path& temp) {
    std::set<long long> alive;
    for (const auto& row : proc::process_table()) alive.insert(row.pid);
    if (alive.empty()) return 0;
    std::vector<fs::path> doomed;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(temp, ec)) {
        const std::string name = entry.path().filename().string();
        std::error_code entry_ec;
        if (!entry.is_directory(entry_ec) || entry.is_symlink(entry_ec)) continue;
        const long long root_pid = scratch_root_pid(name);
        if (root_pid > 0 && !alive.count(root_pid) && fs::exists(entry.path() / kScratchMarker, entry_ec)) {
            doomed.push_back(entry.path());
            continue;
        }
        const long long copy_pid = ship_copy_pid(name);
        if (copy_pid > 0 && !alive.count(copy_pid) && fs::exists(temp / (name + kShipCopyMarkerSuffix), entry_ec)) doomed.push_back(entry.path());
    }
    std::size_t removed = 0;
    for (const fs::path& dir : doomed) {
        std::error_code remove_ec;
        fs::remove_all(dir, remove_ec);
        if (remove_ec) continue;
        fs::remove(temp / (dir.filename().string() + kShipCopyMarkerSuffix), remove_ec);
        ++removed;
    }
    return removed;
}

}
