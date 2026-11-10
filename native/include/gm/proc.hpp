#pragma once

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "deoxidene/result.hpp"

namespace gm::proc {

struct Outcome {
    bool started = false;
    int exit_code = -1;
    int signal = 0;
    bool timed_out = false;
    std::string out;
    std::string err;
    std::string launcher;
};

Outcome run(const std::vector<std::string>& argv, const std::filesystem::path& cwd = {},
            std::string_view stdin_text = {}, std::uint64_t timeout_ms = 0);

Outcome shell(std::string_view command, const std::filesystem::path& cwd = {}, std::uint64_t timeout_ms = 0);

const char* signal_name(int signal_number);

#if defined(_WIN32)
long long parent_pid_of_self();
#endif

using Owner = std::uint64_t;

class OwnerScope {
public:
    explicit OwnerScope(Owner owner, std::filesystem::path ledger = {});
    ~OwnerScope();
    OwnerScope(const OwnerScope&) = delete;
    OwnerScope& operator=(const OwnerScope&) = delete;

private:
    Owner previous_;
    std::filesystem::path previous_ledger_;
};

void kill_owned(Owner owner);
void reap_ledger(const std::filesystem::path& ledger);
void reap_ledgers(const std::filesystem::path& dir);

struct SpawnOptions {
    std::filesystem::path cwd;
    std::vector<std::pair<std::string, std::string>> env;
    bool own_group = false;
    bool capture_stderr = false;

    SpawnOptions(std::filesystem::path dir = {}) : cwd(std::move(dir)) {}
};

class Child {
public:
    static deoxidene::Result<std::shared_ptr<Child>, std::string> spawn(const std::vector<std::string>& argv,
                                                                        const SpawnOptions& options = {});
    ~Child();
    Child(const Child&) = delete;
    Child& operator=(const Child&) = delete;

    bool write_line(std::string_view line);
    std::optional<std::string> read_line();
    std::optional<std::string> read_error_chunk();
    void close_input();
    void terminate();
    void kill();
    std::optional<int> wait_for(std::chrono::milliseconds timeout);
    long long pid() const;

private:
    Child() = default;
    struct Handles;
    std::unique_ptr<Handles> handles_;
    std::mutex write_mutex_;
    std::mutex wait_mutex_;
    std::string read_buffer_;
    std::optional<int> exit_code_;
    bool own_group_ = false;
};

}
