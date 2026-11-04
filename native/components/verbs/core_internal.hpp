#pragma once

#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>

#include "gmnew/json.hpp"
#include "gmnew/log.hpp"

namespace gmnew::core {

inline constexpr std::size_t output_page = 20000;
inline constexpr std::size_t tail_cap = 2000;

std::string to_valid_utf8(std::string_view bytes);
std::size_t utf16_length(std::string_view text);
std::size_t byte_at_utf16(std::string_view text, std::size_t units);
std::string utf16_slice(std::string_view text, std::size_t from, std::size_t to);
std::string utf16_tail(std::string_view text, std::size_t units);

json::Value refusal(std::string_view reason);
json::Value failure(std::string message);
std::string node_error(int error_number, std::string_view syscall, const std::filesystem::path* path);
bool is_whole_number(const json::Value* v);
const json::Value* present(const json::Value& args, std::string_view key);

struct FileText {
    std::string text;
    std::string error;
    bool ok = false;
};
FileText read_text(const std::filesystem::path& path, std::string_view open_syscall);
std::string write_text(const std::filesystem::path& path, std::string_view content);

class LockedLog {
public:
    explicit LockedLog(std::shared_ptr<RunLog> log) : log_(std::move(log)) {}
    std::uint64_t append(std::string_view kind, json::Value fields);
    deoxidene::Result<std::vector<json::Value>, std::string> read_all();
    std::filesystem::path dir() const;
    void bind(std::shared_ptr<RunLog> log);

private:
    std::shared_ptr<RunLog> current() const;

    std::shared_ptr<RunLog> log_;
    mutable std::mutex mutex_;
};

class JobTable {
public:
    JobTable(std::filesystem::path workspace, LockedLog& log, std::uint64_t lifetime_ms);
    ~JobTable();

    json::Value start(const std::string& name, const std::string& command, std::uint64_t timeout_ms);
    json::Value status(const json::Value& args);
    json::Value stop(const json::Value& args);
    void close(std::string_view reason);
    void stop_orphans();

private:
    struct Job;
    void settle(Job& job, std::optional<int> exit_code, json::Value signal);
    void watch(Job& job, std::uint64_t deadline_ms);
    double mono_now();
    void write_status(const std::string& name, const json::Value& status);
    std::optional<json::Value> read_status(const std::string& name);
    std::filesystem::path jobs_dir() const { return log_.dir() / "jobs"; }

    std::filesystem::path workspace_;
    LockedLog& log_;
    std::uint64_t lifetime_ms_;
    std::mutex mutex_;
    std::condition_variable changed_;
    std::map<std::string, std::unique_ptr<Job>> jobs_;
    std::optional<double> mono_offset_;
};

}  // namespace gmnew::core
