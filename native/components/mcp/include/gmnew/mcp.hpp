#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <iosfwd>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "deoxidene/result.hpp"
#include "gmnew/json.hpp"
#include "gmnew/log.hpp"
#include "gmnew/verbs.hpp"

namespace gmnew::mcp {

using BodyRunner = std::function<deoxidene::Result<json::Value, std::string>(VerbTable&, std::string_view body,
                                                                             const std::filesystem::path& project_root, std::string_view format)>;
using LineWriter = std::function<void(std::string_view line)>;

struct ServerOptions {
    std::filesystem::path workspace;
    std::filesystem::path runs;
    std::filesystem::path skills;
    std::string task;
    std::optional<std::filesystem::path> run_dir;
    int max_steps = 50;
    int max_inflight = 8;
    bool supervised = false;
    std::string restart_reason = "restarted without a reason";
    std::string version = GMNEW_MCP_VERSION;
    std::uint64_t job_lifetime_ms = 1800000;
    std::uint64_t stuck_ms = 180000;
    std::uint64_t monitor_ms = 15000;
    std::uint64_t notice_ms = 180000;
    std::string wait_program = "gmnew";
    BodyRunner run_body;
    std::function<void(std::shared_ptr<RunLog> log)> on_run_open;
    std::function<json::Value()> job_snapshot;
    std::function<void()> flush_job_events;
};

class Server {
public:
    static deoxidene::Result<std::unique_ptr<Server>, std::string> open(VerbTable& verbs, ServerOptions options,
                                                                       LineWriter write);
    ~Server();

    void accept(std::string_view line);
    void dispatch(std::string_view line, std::vector<std::thread>& workers);
    void input_ended();
    std::string run_id() const;
    std::filesystem::path run_dir() const;

    struct State;

private:
    explicit Server(std::unique_ptr<State> state);
    std::unique_ptr<State> state_;
};

int serve_stream(std::istream& in, std::ostream& out, VerbTable& verbs, ServerOptions options);

int serve(std::istream& in, std::ostream& out, VerbTable& verbs, std::filesystem::path workspace,
          std::filesystem::path runs, std::filesystem::path skills, ServerOptions options = {});

std::string sha256_hex(std::string_view bytes);

std::optional<std::string> served_skill_text(const std::filesystem::path& skills, const std::string& uri);

void enqueue_pending(const RunLog& log, std::string_view kind, std::uint64_t seq);

}
