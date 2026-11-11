#pragma once

#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <ctime>
#include <functional>
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

#include "gm/json.hpp"
#include "gm/log.hpp"
#include "gm/verbs.hpp"

namespace gm::core {

class LockedLog;

std::string sha256_hex(std::string_view text);

inline std::string normalize_path(const std::string& path) {
    std::string drive;
    std::string rest = path;
    if (path.size() >= 2 && path[1] == ':') {
        drive = path.substr(0, 2);
        rest = path.substr(2);
    }
    std::vector<std::string> parts;
    std::string piece;
    for (std::size_t i = 0; i <= rest.size(); ++i) {
        const char c = i < rest.size() ? rest[i] : '/';
        if (c == '/' || c == '\\') {
            if (piece == "..") {
                if (!parts.empty()) parts.pop_back();
            } else if (!piece.empty() && piece != ".") {
                parts.push_back(piece);
            }
            piece.clear();
        } else {
            piece += c;
        }
    }
    std::string out = drive;
    if (!rest.empty() && (rest[0] == '/' || rest[0] == '\\')) out += "/";
    for (std::size_t i = 0; i < parts.size(); ++i) out += (i ? "/" : "") + parts[i];
    return out;
}

inline bool is_absolute(const std::string& path) {
    return (!path.empty() && path[0] == '/') || (path.size() >= 3 && std::isalpha(static_cast<unsigned char>(path[0])) && path[1] == ':' && (path[2] == '\\' || path[2] == '/'));
}


inline std::string iso_now() {
    const auto now = std::chrono::system_clock::now();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count() % 1000;
    const std::time_t secs = std::chrono::system_clock::to_time_t(now);
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &secs);
#else
    gmtime_r(&secs, &utc);
#endif
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ", utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec, static_cast<long long>(ms));
    return buf;
}


bool is_row_verb(std::string_view name);
const std::vector<VerbInfo>& row_verbs();
json::Value row_call(std::string_view name, const json::Value& args, const std::filesystem::path& workspace, LockedLog& log);
json::Value wiki_call(std::string_view name, const json::Value& args, const std::filesystem::path& workspace, LockedLog& log);
bool is_wiki_verb(std::string_view name);
bool is_git_verb(std::string_view name);
bool is_review_verb(std::string_view name);
json::Value review_call(std::string_view name, const json::Value& args, const std::filesystem::path& workspace, LockedLog& log);
json::Value git_call(std::string_view name, const json::Value& args, const std::filesystem::path& workspace, LockedLog& log);
json::Value fetch_call(const json::Value& args, const std::filesystem::path& workspace, LockedLog& log, const std::filesystem::path& run_dir);

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

inline std::string check_key(const std::string& command) {
    std::string out;
    bool gap = false;
    for (char c : command) {
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            gap = true;
            continue;
        }
        if (gap && !out.empty()) out += ' ';
        gap = false;
        out += c;
        if (out.size() >= 120) break;
    }
    if (out.size() > 120) out.resize(120);
    return out;
}

class LockedLog {
public:
    using AppendHook = std::function<void(const RunLog& log, std::string_view kind, std::uint64_t seq)>;
    LockedLog(std::shared_ptr<RunLog> log, AppendHook on_append) : log_(std::move(log)), on_append_(std::move(on_append)) {}
    std::uint64_t append(std::string_view kind, json::Value fields);
    deoxidene::Result<std::vector<json::Value>, std::string> read_all();
    std::uint64_t count();
    deoxidene::Result<LogWindow, std::string> read_window(std::uint64_t after_seq, std::size_t max_events, std::size_t max_bytes, LogMatch match = {});
    deoxidene::Result<std::vector<json::Value>, std::string> read_last(std::size_t n, std::uint64_t after_seq = 0, LogMatch match = {});
    std::filesystem::path dir() const;
    void bind(std::shared_ptr<RunLog> log);

private:
    std::shared_ptr<RunLog> current() const;

    std::shared_ptr<RunLog> log_;
    AppendHook on_append_;
    mutable std::mutex mutex_;
};

class JobTable {
public:
    JobTable(std::filesystem::path workspace, LockedLog& log, std::uint64_t lifetime_ms);
    ~JobTable();

    json::Value start(const std::string& name, const std::string& command, std::uint64_t timeout_ms, const std::optional<std::string>& progress = std::nullopt);
    json::Value status(const json::Value& args);
    json::Value stop(const json::Value& args);
    void close(std::string_view reason);
    void stop_orphans();
    json::Value snapshot(std::uint64_t stuck_ms);
    void flush_ended();

private:
    struct Job;
    struct UnloggedEvent {
        std::string kind;
        json::Value fields;
    };
    void flush_ended_locked();
    void flush_after_grace();
    void settle(Job& job, std::optional<int> exit_code, json::Value signal);
    void watch(Job& job, std::uint64_t deadline_ms);
    bool adopt_orphan(const std::string& name, const json::Value& status);
    bool adopt_job(const std::string& name, const json::Value& status);
    void poll_adopted(Job& job);
    std::optional<int> read_exit_code(const std::string& name) const;
    std::filesystem::path exit_file_of(const std::string& name) const;
    void write_status(const std::filesystem::path& dir, const std::string& name, const json::Value& status);
    std::optional<json::Value> read_status(const std::string& name);
    std::filesystem::path jobs_dir() const { return log_.dir() / "jobs"; }
    std::filesystem::path job_key(const std::string& name) const { return jobs_dir() / name; }

    std::filesystem::path workspace_;
    LockedLog& log_;
    std::uint64_t lifetime_ms_;
    std::mutex mutex_;
    std::condition_variable changed_;
    std::map<std::filesystem::path, std::unique_ptr<Job>> jobs_;
    std::vector<UnloggedEvent> unlogged_;
};

}
