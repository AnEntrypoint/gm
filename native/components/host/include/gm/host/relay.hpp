#pragma once

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "gm/host/child.hpp"
#include "gm/host/update.hpp"
#include "gm/json.hpp"

namespace gm::host {

using SourceStamp = std::pair<std::filesystem::file_time_type, std::uintmax_t>;
using SourceStamps = std::map<std::filesystem::path, SourceStamp>;

struct RelayOptions {
    std::vector<std::string> worker_argv;
    std::filesystem::path worker_cwd;
    std::vector<std::filesystem::path> runtime_roots;
    std::vector<std::filesystem::path> build_roots;
    std::filesystem::path build_dir;
    std::string build_target = "gm";
    std::chrono::milliseconds poll{500};
    std::chrono::milliseconds drain_timeout{30000};
    std::chrono::milliseconds settle{250};
    std::chrono::milliseconds stop_grace{5000};
    std::chrono::milliseconds exit_grace{10000};
    std::chrono::milliseconds handshake_timeout{10000};
    std::chrono::milliseconds list_timeout{5000};
    std::chrono::milliseconds retry_min{1000};
    std::chrono::milliseconds retry_max{30000};
    std::function<void(std::string_view)> say;
    std::vector<std::string> reexec_argv;
    std::optional<json::Value> initialize;
    bool skill_read = false;
    std::vector<std::string> resend;
    std::optional<UpdatePolicy> update;
};

class Relay {
public:
    Relay(RelayOptions options, std::function<void(std::string_view)> to_host);
    ~Relay();
    Relay(const Relay&) = delete;
    Relay& operator=(const Relay&) = delete;

    void start();
    void host_line(std::string line);
    void host_closed();
    void request_restart(std::string reason);
    void reexec();
    bool only_resendable_in_flight() const;

    std::uint64_t restarts() const;
    std::uint64_t failed_builds() const;
    long long worker_pid() const;
    bool running() const;

private:
    enum class State { Starting, Running, Draining, Restarting, Failed, Stopping };
    using Lock = std::unique_lock<std::mutex>;
    struct Waiter {
        std::optional<json::Value> reply;
    };

    void control_loop();
    void update_loop();
    void read_loop(std::shared_ptr<Child> child);
    void route_host_line(Lock& lock, std::string line);
    void send_to_worker(Lock& lock, const std::string& line);
    bool spawn_worker(Lock& lock);
    void stop_worker(Lock& lock);
    void restart(Lock& lock, const std::string& reason);
    void fail_with(Lock& lock, const std::string& reason);
    void mark_running(Lock& lock);
    std::optional<json::Value> ask_worker(Lock& lock, const std::string& id, const std::string& method,
                                          json::Value params, std::chrono::milliseconds timeout);
    bool replay_handshake(Lock& lock);
    void announce_changes(Lock& lock);
    void flush_held(Lock& lock);
    std::optional<std::string> sources_changed(const std::vector<std::filesystem::path>& roots, SourceStamps& stamps);
    void rebuild(Lock& lock);
    bool binary_settled(Lock& lock);
    std::filesystem::path binary() const;
    std::vector<std::filesystem::path> restart_roots() const;
    void emit(const std::string& line);
    void say(std::string_view message);

    RelayOptions options_;
    std::function<void(std::string_view)> to_host_;
    std::mutex output_mutex_;

    mutable std::mutex mutex_;
    std::condition_variable changed_;
    State state_ = State::Starting;
    bool swapping_ = false;
    bool host_gone_ = false;
    std::shared_ptr<Child> child_;
    std::thread reader_;
    std::thread control_;
    std::thread updater_;
    bool reexec_pending_ = false;
    std::map<std::string, std::string> inflight_;
    std::map<std::string, std::string> resendable_;
    std::map<std::string, std::shared_ptr<Waiter>> waiters_;
    std::vector<std::string> held_;
    std::optional<json::Value> host_initialize_;
    bool skill_read_ = false;
    std::map<std::string, std::string> seen_lists_;
    std::optional<std::string> pending_restart_;
    std::string failure_;
    std::chrono::milliseconds retry_delay_;
    std::optional<std::chrono::steady_clock::time_point> retry_at_;
    SourceStamps source_stamps_;
    SourceStamps build_stamps_;
    bool deferred_restart_ = false;
    bool child_ended_ = false;
    std::uint64_t restarts_ = 0;
    std::uint64_t failed_builds_ = 0;
};

int serve_stdio(RelayOptions options);

}
