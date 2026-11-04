#pragma once

#include <chrono>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "deoxidene/result.hpp"

namespace gmnew::host {

class Child {
public:
    static deoxidene::Result<std::shared_ptr<Child>, std::string> spawn(const std::vector<std::string>& argv,
                                                                        const std::filesystem::path& cwd = {});
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
};

std::filesystem::path current_executable();

}  // namespace gmnew::host
