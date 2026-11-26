#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <unistd.h>

#include <atomic>
#include <mutex>
#include <set>
#include <thread>

namespace gm::tool {

namespace {

constexpr int kSpawners = 4;
constexpr int kChildrenPerSpawner = 60;
constexpr int kReaders = 3;

}

CheckResult check_proc_read_exits(const std::string&) {
    CheckResult result;
    const long long self = ::getpid();
    std::atomic<int> spawned{0};
    std::atomic<int> spawners_left{kSpawners};
    std::atomic<long long> observed{0};
    std::atomic<long long> reads{0};
    std::atomic<int> thrown{0};
    std::string first_error;
    std::mutex error_mutex;

    auto note = [&](const std::string& what) {
        std::lock_guard<std::mutex> lock(error_mutex);
        if (thrown++ == 0) first_error = what;
    };

    std::vector<std::thread> threads;
    for (int s = 0; s < kSpawners; ++s) {
        threads.emplace_back([&] {
            for (int n = 0; n < kChildrenPerSpawner; ++n) {
                proc::run({"sleep", "0.03"}, {}, {}, 20000);
                ++spawned;
            }
            --spawners_left;
        });
    }
    for (int r = 0; r < kReaders; ++r) {
        threads.emplace_back([&] {
            std::set<long long> seen;
            while (spawners_left.load() > 0) {
                for (const proc::ProcessRow& row : proc::process_table()) {
                    if (row.parent != self || row.zombie || !seen.insert(row.pid).second) continue;
                    ++observed;
                    try {
                        while (proc::start_time_of(row.pid) != 0) {
                            proc::command_of(row.pid);
                            ++reads;
                        }
                    } catch (const std::exception& error) {
                        note(error.what());
                    }
                }
            }
        });
    }
    for (std::thread& thread : threads) thread.join();

    if (thrown.load() > 0) {
        result.failures.push_back("reading /proc of an exiting process threw " + std::to_string(thrown.load()) + " time(s), first: " + first_error);
    }
    if (observed.load() < 20 || reads.load() < 20) {
        result.failures.push_back("the readers saw only " + std::to_string(observed.load()) + " children and " + std::to_string(reads.load()) + " reads of " + std::to_string(spawned.load()) + " spawned, too few to exercise an exit");
    }
    if (result.failures.empty()) {
        result.summary = "start_time_of and command_of read " + std::to_string(observed.load()) + " exiting children " + std::to_string(reads.load()) + " times with no exception";
    }
    return result;
}

}

#else

namespace gm::tool {

CheckResult check_proc_read_exits(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}

#endif
