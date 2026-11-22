#pragma once

#include <atomic>
#include <condition_variable>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <map>
#include <optional>
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

inline bool phase_b_output_is_stub(const std::string& output) { return output.find("ok (skipped") != std::string::npos; }
int run_phase_b_checks(const std::filesystem::path& root, const std::filesystem::path& build, const std::string& gm);
std::string checkout_stamp(const std::filesystem::path& root);
std::vector<std::string> install_differences(const std::filesystem::path& root, const std::filesystem::path& current);
std::vector<long long> process_tree(const std::vector<long long>& roots);
void kill_processes(const std::vector<long long>& pids);
std::vector<long long> alive_of(const std::vector<long long>& pids);
std::vector<long long> processes_mentioning(const std::string& text);

const std::vector<Registered>& checks();

#define CHECK(name, fn) CheckResult fn(const std::string& binary);
#include "gm/checks.def"
#undef CHECK

class HoldServer {
public:
    HoldServer(std::chrono::milliseconds hold, std::string body);
    ~HoldServer();
    HoldServer(const HoldServer&) = delete;
    HoldServer& operator=(const HoldServer&) = delete;
    int port() const;
    bool requested() const;
    std::optional<std::chrono::steady_clock::time_point> closed_at() const;

private:
    void serve(int client);
    std::chrono::milliseconds hold_;
    std::string body_;
    int listen_fd_ = -1;
    int port_ = 0;
    std::thread accepter_;
    std::atomic<bool> requested_{false};
    mutable std::mutex mutex_;
    std::optional<std::chrono::steady_clock::time_point> closed_at_;
};

struct Inbox {
    std::mutex mutex;
    std::condition_variable cv;
    std::map<std::int64_t, json::Value> replies;
    bool closed = false;
    std::vector<json::Value> notes;
    std::vector<std::string> strays;
    std::string errors;
};

class Session {
public:
    Session(const std::string& binary, const std::filesystem::path& workspace, const std::filesystem::path& home,
            std::uint64_t watchdog_ms = 180000, bool quiet = true, std::vector<std::string> extra = {},
            std::vector<std::pair<std::string, std::string>> env = {});
    Session(std::vector<std::string> argv, const std::filesystem::path& workspace, const std::filesystem::path& home, std::uint64_t watchdog_ms = 180000);
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    bool started() const { return child_ != nullptr; }
    bool expired() const { return expired_; }
    std::vector<long long> descendants() const;
    json::Value rpc(const std::string& method, json::Value params);
    std::int64_t send(const std::string& method, json::Value params);
    std::optional<json::Value> await_reply(std::int64_t id, std::chrono::milliseconds wait);
    std::vector<json::Value> notes() const;
    std::vector<std::string> stray_lines() const;
    std::string stderr_text() const;
    long long pid() const;
    void notify(const std::string& method, json::Value params);
    std::string body(const std::string& source);
    void stop();
    void close_input();
    std::optional<int> wait_exit(std::chrono::milliseconds timeout);

private:
    std::shared_ptr<proc::Child> child_;
    std::shared_ptr<Inbox> inbox_;
    std::atomic<std::int64_t> next_id_{1};
    std::mutex mutex_;
    std::condition_variable done_cv_;
    bool done_ = false;
    std::atomic<bool> expired_{false};
    std::thread watchdog_;
    void start(const std::vector<std::string>& argv, const std::filesystem::path& workspace, const std::filesystem::path& home, std::uint64_t watchdog_ms,
               std::vector<std::pair<std::string, std::string>> env = {});
};

std::optional<std::string> git_output(const std::filesystem::path& root, const std::vector<std::string>& args);
std::vector<std::string> nul_split(const std::string& text);
std::string tool_text(Session& session, const std::string& name, json::Value args);
json::Value tool_json(Session& session, const std::string& name, json::Value args);
std::vector<json::Value> run_events(const std::filesystem::path& log, const std::string& kind);
void set_env(const char* name, const char* value);
void unset_env(const char* name);
json::Value output_value(const json::Value& reply);
std::string text_at(const json::Value& value, const std::string& dotted);
const json::Value* value_at(const json::Value& value, const std::string& dotted);

struct GateCheck {
    std::string name;
    bool ok = false;
    std::string detail;
};

std::vector<GateCheck> run_gate(const std::filesystem::path& root);
int gate_command(const std::filesystem::path& root);
int phase_b_command(const std::filesystem::path& root, const std::filesystem::path& build);
int ship_command(const std::filesystem::path& root, const std::vector<std::string>& args);
int ship_push(const std::filesystem::path& root);
int installed_command(const std::filesystem::path& root);
int package_command(const std::filesystem::path& root, const std::vector<std::string>& args);
int release_manifest_command(const std::vector<std::string>& args);
int prune_assets_command(const std::vector<std::string>& args);
int repos_command(const std::filesystem::path& root, bool strict);

}
