#pragma once

#include <atomic>
#include <condition_variable>
#include <filesystem>
#include <memory>
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

const std::vector<Registered>& checks();

class Session {
public:
    Session(const std::string& binary, const std::filesystem::path& workspace, const std::filesystem::path& home,
            std::uint64_t watchdog_ms = 180000);
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    bool started() const { return child_ != nullptr; }
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

}
