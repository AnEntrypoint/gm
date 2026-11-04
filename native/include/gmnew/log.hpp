#pragma once

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

#include "deoxidene/result.hpp"
#include "gmnew/json.hpp"

namespace gmnew {

class RunLog {
public:
    static deoxidene::Result<RunLog, std::string> open(std::filesystem::path run_dir);

    std::uint64_t append(std::string_view kind, json::Value fields);

    deoxidene::Result<std::vector<json::Value>, std::string> read_all() const;

    double now_ms() const;

    std::uint64_t count() const;

    deoxidene::Result<std::vector<json::Value>, std::string> read_from(std::uint64_t after_seq) const;

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
