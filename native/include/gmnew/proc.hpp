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

namespace gmnew::proc {

struct Outcome {
    bool started = false;
    int exit_code = -1;
    bool timed_out = false;
    std::string out;
    std::string err;
};

Outcome run(const std::vector<std::string>& argv, const std::filesystem::path& cwd = {},
            std::string_view stdin_text = {}, std::uint64_t timeout_ms = 0);

Outcome shell(std::string_view command, const std::filesystem::path& cwd = {}, std::uint64_t timeout_ms = 0);

struct SpawnOptions {
    std::filesystem::path cwd;
    std::vector<std::pair<std::string, std::string>> env;
    bool own_group = false;

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
