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

CheckResult check_read_after_write(const std::string& binary);
CheckResult check_spawn_sites(const std::string& binary);
CheckResult check_lazy_browser(const std::string& binary);
CheckResult check_browser_scope(const std::string& binary);
CheckResult check_browser_first_open(const std::string& binary);
CheckResult check_rows(const std::string& binary);
CheckResult check_fetch(const std::string& binary);
CheckResult check_wiki(const std::string& binary);
CheckResult check_git(const std::string& binary);
CheckResult check_review(const std::string& binary);
CheckResult check_code_ast(const std::string& binary);
CheckResult check_quickjs_baseline(const std::string& binary);
CheckResult check_install_follows(const std::string& binary);
CheckResult check_skill_reload(const std::string& binary);
CheckResult check_cli_flags(const std::string& binary);
CheckResult check_stop_fetch(const std::string& binary);
CheckResult check_install_switch(const std::string& binary);
CheckResult check_restart_skill_read(const std::string& binary);
CheckResult check_no_resource_client(const std::string& binary);
CheckResult check_turn_end_release(const std::string& binary);
CheckResult check_mcp_args(const std::string& binary);
CheckResult check_run_code_budget(const std::string& binary);
CheckResult check_turn_economy(const std::string& binary);
CheckResult check_restart_jobs(const std::string& binary);
CheckResult check_run_code_progress(const std::string& binary);
CheckResult check_read_parity(const std::string& binary);
CheckResult check_protocol_versions(const std::string& binary);
CheckResult check_relay_reexec(const std::string& binary);
CheckResult check_handover_in_flight(const std::string& binary);
CheckResult check_witness_next_context_replay(const std::string& binary);
CheckResult check_build_handover(const std::string& binary);
CheckResult check_console(const std::string& binary);
CheckResult check_mcp_conformance(const std::string& binary);
CheckResult check_parity_contract(const std::string& binary);
CheckResult check_clock_mutations(const std::string& binary);
CheckResult check_witness_windows_cmd(const std::string& binary);
int run_phase_b_checks(const std::filesystem::path& root, const std::filesystem::path& build, const std::string& gm);
CheckResult check_embedded_runtime(const std::string& binary);
CheckResult check_skill_serve(const std::string& binary);
CheckResult check_resources_subscribe(const std::string& binary);
CheckResult check_startup_attempts(const std::string& binary);
CheckResult check_repeated_checks(const std::string& binary);
CheckResult check_owner_identity(const std::string& binary);
CheckResult check_cut_marker(const std::string& binary);
CheckResult check_grep_state_scope(const std::string& binary);
CheckResult check_job_bounds(const std::string& binary);
CheckResult check_shell_stdin(const std::string& binary);
CheckResult check_run_child_reap(const std::string& binary);
CheckResult check_reap_identity(const std::string& binary);
CheckResult check_job_status_cancel(const std::string& binary);
CheckResult check_cancel_wait(const std::string& binary);
CheckResult check_cancel_record(const std::string& binary);
CheckResult check_early_run_code(const std::string& binary);
CheckResult check_worker_growth(const std::string& binary);
CheckResult check_feed_reference(const std::string& binary);
CheckResult check_job_wait(const std::string& binary);
CheckResult check_asan_retention(const std::string& binary);
std::vector<long long> process_tree(const std::vector<long long>& roots);
void kill_processes(const std::vector<long long>& pids);
std::vector<long long> alive_of(const std::vector<long long>& pids);
std::vector<long long> processes_mentioning(const std::string& text);

const std::vector<Registered>& checks();

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

private:
    std::shared_ptr<proc::Child> child_;
    std::shared_ptr<Inbox> inbox_;
    std::atomic<std::int64_t> next_id_{1};
    std::mutex mutex_;
    std::condition_variable done_cv_;
    bool done_ = false;
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
int installed_command(const std::filesystem::path& root);
int package_command(const std::filesystem::path& root, const std::vector<std::string>& args);
int release_manifest_command(const std::vector<std::string>& args);
int prune_assets_command(const std::vector<std::string>& args);
int repos_command(const std::filesystem::path& root, bool strict);

}
