#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

#include "deoxidene/result.hpp"
#include "gm/json.hpp"

namespace gm {

struct LogWindow {
    std::vector<json::Value> events;
    std::uint64_t scanned_last = 0;
    std::uint64_t count = 0;
    std::size_t bytes_read = 0;
};

using LogMatch = std::function<bool(const json::Value&)>;

class RunLog {
public:
    static deoxidene::Result<RunLog, std::string> open(std::filesystem::path run_dir);

    std::uint64_t append(std::string_view kind, json::Value fields);

    deoxidene::Result<std::vector<json::Value>, std::string> read_all() const;

    double now_ms() const;

    std::uint64_t count() const;

    deoxidene::Result<std::vector<json::Value>, std::string> read_from(std::uint64_t after_seq) const;

    deoxidene::Result<LogWindow, std::string> read_window(std::uint64_t after_seq, std::size_t max_events, std::size_t max_bytes, LogMatch match = {}) const;

    deoxidene::Result<std::vector<json::Value>, std::string> read_last(std::size_t n, std::uint64_t after_seq = 0, LogMatch match = {}) const;

    const std::filesystem::path& dir() const { return dir_; }

private:
    explicit RunLog(std::filesystem::path dir, std::uint64_t next_seq);

    std::filesystem::path dir_;
    std::uint64_t next_seq_;
    double mono_base_ = 0;
    std::unique_ptr<std::mutex> lock_ = std::make_unique<std::mutex>();
    std::chrono::steady_clock::time_point opened_ = std::chrono::steady_clock::now();
};

}
