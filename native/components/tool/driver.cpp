#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <system_error>
#include <thread>
#include <unistd.h>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

constexpr std::uint64_t kCheckTimeoutMs = 600000;
constexpr const char* kMutations = "clock-mutations";
const std::set<std::string> kExclusive{"check-relay-reexec", "check-browser-scope", "check-lazy-browser", "check-browser-first-open"};

using Clock = std::chrono::steady_clock;

struct Fnv {
    std::uint64_t value = 1469598103934665603ULL;
    void add(std::string_view bytes) {
        for (const unsigned char c : bytes) {
            value ^= c;
            value *= 1099511628211ULL;
        }
    }
    std::string hex() const {
        char out[17];
        std::snprintf(out, sizeof out, "%016llx", static_cast<unsigned long long>(value));
        return out;
    }
};

std::string hash_of(std::string_view text) {
    Fnv fnv;
    fnv.add(text);
    return fnv.hex();
}

std::string file_hash(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    Fnv fnv;
    char buffer[65536];
    while (in.read(buffer, sizeof buffer) || in.gcount() > 0) fnv.add(std::string_view(buffer, static_cast<std::size_t>(in.gcount())));
    return fnv.hex();
}

std::string stat_of(const fs::path& path) {
    std::error_code ec;
    const auto size = fs::file_size(path, ec);
    if (ec) return "missing";
    const auto mtime = fs::last_write_time(path, ec).time_since_epoch().count();
    return std::to_string(size) + ":" + std::to_string(static_cast<long long>(mtime));
}

std::map<std::string, std::string> tree_state(const fs::path& root) {
    std::map<std::string, std::string> state;
    for (const auto& name : nul_split(git_output(root, {"ls-files", "-z"}).value_or(""))) {
        const fs::path full = root / name;
        std::error_code ec;
        const auto status = fs::symlink_status(full, ec);
        if (fs::is_symlink(status)) {
            state[name] = "link:" + fs::read_symlink(full, ec).string();
            continue;
        }
        if (!fs::is_regular_file(status)) {
            state[name] = fs::exists(status) ? "other" : "missing";
            continue;
        }
        state[name] = stat_of(full) + ":" + file_hash(full);
    }
    return state;
}

std::string fingerprint(const fs::path& root, const fs::path& gm, const fs::path& tool) {
    Fnv fnv;
    fnv.add(gm.string() + "=" + stat_of(gm) + "\n");
    fnv.add(tool.string() + "=" + stat_of(tool) + "\n");
    fnv.add(git_output(root, {"rev-parse", "HEAD^{tree}"}).value_or("no-tree"));
    fnv.add(git_output(root, {"status", "--porcelain", "--untracked-files=no"}).value_or("no-status"));
    return fnv.hex();
}

std::map<std::string, std::string> read_pairs(const fs::path& path) {
    std::map<std::string, std::string> pairs;
    std::ifstream in(path);
    for (std::string name, value; in >> name >> value;) pairs[name] = value;
    return pairs;
}

void write_pairs(const fs::path& path, const std::map<std::string, std::string>& pairs) {
    std::ofstream out(path, std::ios::trunc);
    for (const auto& [name, value] : pairs) out << name << ' ' << value << '\n';
}

bool environ_has(const std::string& pid, const std::string& entry) {
    std::ifstream in("/proc/" + pid + "/environ", std::ios::binary);
    const std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    std::size_t start = 0;
    while (start < text.size()) {
        const std::size_t end = text.find('\0', start);
        if (text.compare(start, (end == std::string::npos ? text.size() : end) - start, entry) == 0) return true;
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return false;
}

std::vector<long long> marked(const std::string& entry) {
    std::vector<long long> pids;
    std::error_code ec;
    const std::string self = std::to_string(::getpid());
    for (const auto& item : fs::directory_iterator("/proc", ec)) {
        const std::string name = item.path().filename().string();
        if (name.empty() || name == self || name.find_first_not_of("0123456789") != std::string::npos) continue;
        if (environ_has(name, entry)) pids.push_back(std::stoll(name));
    }
    return pids;
}

std::vector<long long> stop_marked(const std::string& entry) {
    auto left = marked(entry);
    for (int tries = 0; !left.empty() && tries < 20; ++tries) {
        for (const long long pid : left) ::kill(static_cast<pid_t>(pid), SIGKILL);
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        left = marked(entry);
    }
    return left;
}

std::string safe_label(const std::string& label) {
    std::string out;
    for (const char c : label) out.push_back(std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-' ? c : '_');
    return out;
}

std::string tail_lines(const std::string& text, std::size_t lines) {
    std::vector<std::string> all;
    std::istringstream in(text);
    for (std::string line; std::getline(in, line);) all.push_back(line);
    std::string out;
    for (std::size_t i = all.size() > lines ? all.size() - lines : 0; i < all.size(); ++i) out += "  " + all[i] + "\n";
    return out;
}

double load_one() {
    double load[1] = {0};
    return ::getloadavg(load, 1) == 1 ? load[0] : 0;
}

struct Job {
    std::string name;
    std::string key;
};

struct Timing {
    std::string name;
    double wall = 0;
};

class Driver {
public:
    Driver(fs::path root, fs::path build, std::string gm)
        : root_(std::move(root)), build_(std::move(build)), gm_(std::move(gm)),
          tool_(build_ / "native" / "components" / "tool" / "gm-tool"), logs_(build_ / "phase-b-logs"),
          cache_path_(build_ / "phase-b-cache.txt"), durations_path_(build_ / "phase-b-durations.txt"),
          marker_("phaseb-" + std::to_string(::getpid()) + "-" + std::to_string(Clock::now().time_since_epoch().count())) {}

    int run() {
        const auto started = Clock::now();
        const auto before = tree_state(root_);
        std::error_code ec;
        fs::create_directories(logs_, ec);
        cache_ = read_pairs(cache_path_);
        for (const auto& [name, value] : read_pairs(durations_path_)) durations_[name] = std::atof(value.c_str());
        const char* jobs_env = std::getenv("GM_CHECK_JOBS");
        const unsigned cores = std::max(1u, std::thread::hardware_concurrency());
        cores_ = cores;
        lanes_ = jobs_env != nullptr ? std::max(1, std::atoi(jobs_env)) : std::max(1, static_cast<int>(std::min(6u, cores / 2)));
        const char* mutations_env = std::getenv("GM_CHECK_MUTATIONS");
        const bool mutations = mutations_env != nullptr && std::string(mutations_env) == "1";

        const std::string fp = fingerprint(root_, gm_, tool_);
        std::vector<Job> pool;
        std::vector<Job> exclusive;
        int skipped = 0;
        for (const auto& check : checks()) {
            if (check.name == kMutations) {
                if (!mutations) say("phase-b: " + check.name + " is not run by default: it changes the clock every peer shares; GM_CHECK_MUTATIONS=1 runs it");
                continue;
            }
            const std::string key = hash_of(check.name + ":" + fp);
            if (cache_[check.name] == key) {
                ++skipped;
                skipped_.push_back(check.name);
                say("phase-b: " + check.name + " skipped, inputs unchanged");
                continue;
            }
            (kExclusive.count(check.name) ? exclusive : pool).push_back({check.name, key});
        }
        std::sort(pool.begin(), pool.end(), [this](const Job& a, const Job& b) { return duration_of(a.name) > duration_of(b.name); });
        run_pool(pool);
        for (const auto& job : exclusive) run_one(job);

        cache_.erase(kMutations);
        write_pairs(cache_path_, cache_);
        const auto read_back = read_pairs(cache_path_);
        const std::string fp_after = fingerprint(root_, gm_, tool_);
        std::vector<std::string> unstable;
        std::vector<std::string> expected = passed_;
        expected.insert(expected.end(), skipped_.begin(), skipped_.end());
        for (const auto& name : expected) {
            const auto found = read_back.find(name);
            if (found == read_back.end() || found->second != hash_of(name + ":" + fp_after)) unstable.push_back(name);
        }
        if (!unstable.empty()) {
            failures_.push_back("cache");
            say("phase-b: cache: a second run would rerun " + std::to_string(unstable.size()) + " passing check(s), so their inputs changed during the run or the cache did not read back: " + unstable.front());
        } else {
            say("phase-b: cache: a second run skips " + std::to_string(expected.size()) + " of " + std::to_string(expected.size()) + " passing check(s), inputs unchanged");
        }

        if (mutations) run_one({kMutations, ""});

        const auto after = tree_state(root_);
        std::vector<std::string> touched;
        for (const auto& [name, value] : before) {
            const auto found = after.find(name);
            if (found == after.end() || found->second != value) touched.push_back(name);
        }
        for (const auto& [name, value] : after)
            if (!before.count(name)) touched.push_back(name);
        if (!touched.empty()) {
            failures_.push_back("tree");
            std::string listed;
            for (std::size_t i = 0; i < touched.size() && i < 10; ++i) listed += (i ? ", " : "") + touched[i];
            say("phase-b: a check changed tracked files in the checkout: " + listed + (touched.size() > 10 ? " ..." : ""));
        }

        std::map<std::string, std::string> durations_out;
        for (const auto& [name, wall] : durations_) durations_out[name] = std::to_string(wall);
        write_pairs(durations_path_, durations_out);

        auto longest = timings_;
        std::sort(longest.begin(), longest.end(), [](const Timing& a, const Timing& b) { return a.wall > b.wall; });
        std::string top;
        for (std::size_t i = 0; i < longest.size() && i < 5; ++i) top += (i ? "; " : "") + longest[i].name + " " + seconds(longest[i].wall);
        const double wall = std::chrono::duration<double>(Clock::now() - started).count();
        say("phase-b: checks: " + std::to_string(timings_.size()) + " run, " + std::to_string(failures_.size()) + " failed, " + std::to_string(rescued_.size()) +
            " passed alone after a pool failure, " + std::to_string(skipped) + " skipped, jobs " + std::to_string(lanes_) + ", load " + one_decimal(load_one()) + " on " +
            std::to_string(cores_) + " cores, wall " + seconds(wall) + "; longest: " + (top.empty() ? "none" : top));
        return failures_.empty() ? 0 : 1;
    }

private:
    double duration_of(const std::string& name) const {
        const auto found = durations_.find(name);
        return found == durations_.end() ? 30.0 : found->second;
    }

    static std::string one_decimal(double value) {
        char out[32];
        std::snprintf(out, sizeof out, "%.1f", value);
        return out;
    }

    static std::string seconds(double value) { return one_decimal(value) + " s"; }

    void say(const std::string& line) {
        std::lock_guard lock(print_mutex_);
        std::printf("%s\n", line.c_str());
        std::fflush(stdout);
    }

    bool run_one(const Job& job) {
        const std::string entry = "GM_CHECK_TREE=" + marker_ + "-" + std::to_string(serial_.fetch_add(1));
        const auto at = Clock::now();
        auto outcome = proc::run({"env", entry, tool_.string(), "check", gm_, job.name}, root_, {}, kCheckTimeoutMs);
        const double wall = std::chrono::duration<double>(Clock::now() - at).count();
        const auto leftover = stop_marked(entry);
        std::string text = outcome.out + outcome.err;
        bool ok = outcome.started && outcome.exit_code == 0 && !outcome.timed_out;
        if (outcome.timed_out) text += "phase-b: " + job.name + " timed out after " + std::to_string(kCheckTimeoutMs) + " ms\n";
        if (ok && outcome.out.find("ok (skipped (") != std::string::npos && outcome.out.find("ok (skipped (not on this platform") == std::string::npos) {
            ok = false;
            text += "phase-b: " + job.name + " was skipped; a row that gates a change must run in the set, so build with -DGMNEW_VERSION=<sha>-1\n";
        }
        if (!leftover.empty()) {
            ok = false;
            std::string pids;
            for (const long long pid : leftover) pids += (pids.empty() ? "" : ", ") + std::to_string(pid);
            text += "phase-b: " + job.name + " left " + std::to_string(leftover.size()) + " process(es) alive: " + pids + "\n";
        }
        const fs::path log = logs_ / (safe_label(job.name) + ".log");
        std::ofstream(log, std::ios::binary | std::ios::trunc) << text;
        {
            std::lock_guard lock(state_mutex_);
            timings_.push_back({job.name, wall});
            durations_[job.name] = wall;
            if (ok) {
                if (!job.key.empty()) {
                    cache_[job.name] = job.key;
                    passed_.push_back(job.name);
                }
            } else {
                cache_.erase(job.name);
                failures_.push_back(job.name);
            }
        }
        if (ok) say("phase-b: " + job.name + " ok " + seconds(wall));
        else say("phase-b: " + job.name + " FAILED " + seconds(wall) + ", log " + log.string() + "\n" + tail_lines(text, 12));
        return ok;
    }

    void run_pool(const std::vector<Job>& jobs) {
        std::atomic<std::size_t> next{0};
        std::vector<std::thread> lanes;
        const std::size_t count = std::min<std::size_t>(static_cast<std::size_t>(lanes_), jobs.size());
        for (std::size_t lane = 0; lane < count; ++lane)
            lanes.emplace_back([&] {
                for (std::size_t index = next.fetch_add(1); index < jobs.size(); index = next.fetch_add(1)) run_one(jobs[index]);
            });
        for (auto& lane : lanes) lane.join();
        for (const auto& job : jobs) {
            const auto found = std::find(failures_.begin(), failures_.end(), job.name);
            if (found == failures_.end()) continue;
            failures_.erase(found);
            const fs::path log = logs_ / (safe_label(job.name) + ".log");
            std::error_code ec;
            fs::rename(log, logs_ / (safe_label(job.name) + ".first-failure.log"), ec);
            if (run_one(job)) {
                rescued_.push_back(job.name);
                say("phase-b: " + job.name + " passed alone after failing in the pool (load " + one_decimal(load_one()) + " on " + std::to_string(cores_) + " cores)");
            }
        }
    }

    fs::path root_;
    fs::path build_;
    std::string gm_;
    fs::path tool_;
    fs::path logs_;
    fs::path cache_path_;
    fs::path durations_path_;
    std::string marker_;
    std::atomic<std::uint64_t> serial_{0};
    int lanes_ = 1;
    unsigned cores_ = 1;
    std::mutex print_mutex_;
    std::mutex state_mutex_;
    std::map<std::string, std::string> cache_;
    std::map<std::string, double> durations_;
    std::vector<Timing> timings_;
    std::vector<std::string> failures_;
    std::vector<std::string> rescued_;
    std::vector<std::string> passed_;
    std::vector<std::string> skipped_;
};

}

int run_phase_b_checks(const fs::path& root, const fs::path& build, const std::string& gm) {
    Driver driver(root, build, gm);
    return driver.run();
}

}
#else
#include <iostream>

namespace gm::tool {

int run_phase_b_checks(const std::filesystem::path&, const std::filesystem::path&, const std::string&) {
    std::cerr << "gm-tool phase-b: runs on Linux and macOS only\n";
    return 2;
}

}
#endif
