#pragma once

#include <atomic>
#include <condition_variable>
#include <filesystem>
#include <memory>
#include <optional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "gm/json.hpp"
#include "gm/proc.hpp"

namespace gm::tool {

struct CheckResult {
    std::string summary;
    std::vector<std::string> failures;
};

using CheckFn = CheckResult (*)(const std::string& binary);

struct Registered {
    std::string name;
    CheckFn run;
};

CheckResult check_read_after_write(const std::string& binary);
CheckResult check_spawn_sites(const std::string& binary);
CheckResult check_lazy_browser(const std::string& binary);
CheckResult check_rows(const std::string& binary);
CheckResult check_fetch(const std::string& binary);
CheckResult check_wiki(const std::string& binary);
CheckResult check_git(const std::string& binary);

const std::vector<Registered>& checks();

class Session {
public:
    Session(const std::string& binary, const std::filesystem::path& workspace, const std::filesystem::path& home,
            std::uint64_t watchdog_ms = 180000, bool quiet = true);
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    bool started() const { return child_ != nullptr; }
    std::vector<long long> descendants() const;
    json::Value rpc(const std::string& method, json::Value params);
    void notify(const std::string& method, json::Value params);
    std::string body(const std::string& source);
    void stop();

private:
    std::shared_ptr<proc::Child> child_;
    std::atomic<std::int64_t> next_id_{1};
    std::mutex mutex_;
    std::condition_variable done_cv_;
    bool done_ = false;
    std::thread watchdog_;
};

std::optional<std::string> git_output(const std::filesystem::path& root, const std::vector<std::string>& args);
std::vector<std::string> nul_split(const std::string& text);

struct GateCheck {
    std::string name;
    bool ok = false;
    std::string detail;
};

std::vector<GateCheck> run_gate(const std::filesystem::path& root);
int gate_command(const std::filesystem::path& root);
int phase_b_command(const std::filesystem::path& root, const std::filesystem::path& build);
int ship_command(const std::filesystem::path& root, const std::vector<std::string>& args);

}
