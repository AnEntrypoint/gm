#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <csignal>
#if defined(__linux__)
#include <signal.h>
#endif
#include <filesystem>
#include <fstream>
#include <iterator>
#include <map>
#include <set>
#include <sstream>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

struct Proc {
    long long parent = 0;
    bool zombie = false;
};

std::map<long long, Proc> snapshot() {
    std::map<long long, Proc> table;
    for (const auto& row : proc::process_table()) table[row.pid] = Proc{row.parent, row.zombie};
    return table;
}

}

std::vector<long long> process_tree(const std::vector<long long>& roots) {
    const auto table = snapshot();
    std::map<long long, std::vector<long long>> children;
    for (const auto& [pid, proc] : table) children[proc.parent].push_back(pid);
    std::set<long long> found;
    std::vector<long long> frontier;
    for (const long long root : roots) {
        const auto known = table.find(root);
        if (known != table.end() && !known->second.zombie && found.insert(root).second) frontier.push_back(root);
    }
    while (!frontier.empty()) {
        const long long current = frontier.back();
        frontier.pop_back();
        for (const long long child : children[current]) {
            if (!table.at(child).zombie && found.insert(child).second) frontier.push_back(child);
        }
    }
    return std::vector<long long>(found.begin(), found.end());
}

void kill_processes(const std::vector<long long>& pids) {
#if defined(__linux__)
    for (const long long pid : pids) ::kill(static_cast<pid_t>(pid), SIGKILL);
#else
    (void)pids;
#endif
}

std::vector<long long> processes_mentioning(const std::string& text) {
    std::vector<long long> found;
    if (text.empty()) return found;
#if defined(__linux__)
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator("/proc", ec)) {
        const std::string name = entry.path().filename().string();
        if (name.empty() || name.find_first_not_of("0123456789") != std::string::npos) continue;
        std::ifstream cmdline(entry.path() / "cmdline", std::ios::binary);
        const std::string bytes((std::istreambuf_iterator<char>(cmdline)), std::istreambuf_iterator<char>());
        if (bytes.find(text) != std::string::npos) found.push_back(std::stoll(name));
    }
#else
    std::istringstream lines(proc::run({"ps", "-axww", "-o", "pid=,command="}).out);
    std::string line;
    while (std::getline(lines, line)) {
        std::istringstream fields(line);
        long long pid = 0;
        if (fields >> pid && line.find(text) != std::string::npos) found.push_back(pid);
    }
#endif
    return found;
}

std::vector<long long> alive_of(const std::vector<long long>& pids) {
    const auto table = snapshot();
    std::vector<long long> alive;
    for (const long long pid : pids) {
        const auto found = table.find(pid);
        if (found != table.end() && !found->second.zombie) alive.push_back(pid);
    }
    return alive;
}

}
#endif
