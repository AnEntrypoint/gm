#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr int kSettleMs = 3000;
constexpr int kPollMs = 50;

std::shared_ptr<proc::Child> sleeper(const fs::path& dir) {
    proc::SpawnOptions options(dir);
    options.own_group = true;
    auto spawned = proc::Child::spawn({"sleep", "300"}, options);
    return spawned ? *spawned : nullptr;
}

std::string line_for(long long pid, long long start) {
    return std::to_string(pid) + " " + std::to_string(start);
}

std::vector<long long> gone_after_settle(const std::vector<long long>& pids) {
    std::vector<long long> alive = alive_of(pids);
    const auto began = std::chrono::steady_clock::now();
    while (!alive.empty() && std::chrono::steady_clock::now() - began < std::chrono::milliseconds(kSettleMs)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(kPollMs));
        alive = alive_of(pids);
    }
    return alive;
}

}

CheckResult check_reap_identity(const std::string&) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-reap-identity-" + std::to_string(stamp));
    const fs::path jobs = sandbox / "jobs";
    fs::create_directories(jobs);

    std::vector<std::shared_ptr<proc::Child>> held;
    const auto unknown = sleeper(sandbox);
    const auto negative = sleeper(sandbox);
    const auto reused = sleeper(sandbox);
    const auto owned = sleeper(sandbox);
    if (!unknown || !negative || !reused || !owned) {
        result.failures.push_back("could not start the sleep processes the check reaps");
    } else {
        held = {unknown, negative, reused, owned};
        const long long unknown_pid = unknown->pid();
        const long long negative_pid = negative->pid();
        const long long reused_pid = reused->pid();
        const long long owned_pid = owned->pid();
        const long long reused_start = proc::start_time_of(reused_pid);
        const long long owned_start = proc::start_time_of(owned_pid);
        {
            std::ofstream ledger(jobs / "body-reap.pids");
            ledger << line_for(unknown_pid, 0) << '\n';
            ledger << line_for(negative_pid, -1) << '\n';
            ledger << line_for(reused_pid, reused_start + 1) << '\n';
            ledger << line_for(owned_pid, owned_start) << '\n';
        }
        proc::reap_ledgers(jobs);

        const std::vector<long long> survivors = gone_after_settle({unknown_pid, negative_pid, reused_pid});
        const std::vector<long long> killed = gone_after_settle({owned_pid});
        if (survivors.size() != 3) {
            result.failures.push_back("the reaper killed a process whose identity it could not confirm (unknown start time, -1, or a reused pid): survivors " +
                                      std::to_string(survivors.size()) + " of 3");
        }
        if (!killed.empty()) {
            result.failures.push_back("the reaper did not kill a process whose recorded start time matches its current start time: pid " +
                                      std::to_string(owned_pid));
        }
        if (fs::exists(jobs / "body-reap.pids")) {
            result.failures.push_back("the reaper kept the ledger after it had reaped it");
        }
    }

    const fs::path exit_ledger = sandbox / "exit.pids";
    {
        proc::OwnerScope scope(7, exit_ledger);
        const std::string probe = "sleep 1; cat '" + exit_ledger.string() + "' 2>/dev/null; echo \"pid $$\"";
        const auto ran = proc::run({"sh", "-c", probe}, sandbox);
        std::istringstream lines(ran.out);
        std::vector<std::string> listed;
        long long probed = 0;
        for (std::string line; std::getline(lines, line);) {
            if (line.rfind("pid ", 0) == 0) probed = std::atoll(line.c_str() + 4);
            else listed.push_back(line);
        }
        const auto lists = [probed](const std::string& line) { return probed > 0 && std::atoll(line.c_str()) == probed; };
        if (probed <= 0) {
            result.failures.push_back("the probe process did not report its pid: " + ran.out.substr(0, 240));
        } else if (std::none_of(listed.begin(), listed.end(), lists)) {
            result.failures.push_back("the ledger did not list a process while it ran: pid " + std::to_string(probed));
        }
        std::ifstream in(exit_ledger);
        for (std::string line; std::getline(in, line);) {
            if (lists(line)) result.failures.push_back("a process that exited is still listed in its ledger: " + line);
        }
    }

    for (const auto& child : held) {
        if (child) child->kill();
    }
    held.clear();
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a ledger reap kills only a process whose recorded start time is positive and equals its current start time; a process with unknown identity or a reused pid survives, and an exited process leaves its ledger (wall " +
                     std::to_string(wall) + " s)";
    return result;
}

}
