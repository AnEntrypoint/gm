#pragma once

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#if !defined(__wasi__)
#include <mutex>
#include <shared_mutex>
#endif

namespace gm::platform {

struct FileStamp {
    std::int64_t mtime = 0;
    std::uintmax_t size = 0;
    bool operator==(const FileStamp&) const = default;
};

#if defined(__wasi__)
struct Mutex {
    void lock() {}
    void unlock() {}
};

struct SharedMutex {
    void lock() {}
    void unlock() {}
    void lock_shared() {}
    void unlock_shared() {}
};

template <class M>
struct LockGuard {
    explicit LockGuard(M&) {}
};

template <class M>
struct ExclusiveLock {
    explicit ExclusiveLock(M&) {}
};

template <class M>
struct SharedLock {
    explicit SharedLock(M&) {}
};
#else
using Mutex = std::mutex;
using SharedMutex = std::shared_mutex;

template <class M>
using LockGuard = std::lock_guard<M>;

template <class M>
using ExclusiveLock = std::unique_lock<M>;

template <class M>
using SharedLock = std::shared_lock<M>;
#endif

std::optional<std::string> read_file(const std::filesystem::path& file);
std::optional<FileStamp> stamp_of(const std::filesystem::path& file);
bool is_regular_file(const std::filesystem::path& file);
std::vector<std::filesystem::path> regular_files_in(const std::filesystem::path& dir);
std::filesystem::path join_path(const std::filesystem::path& dir, std::string_view name);
std::filesystem::path normal_path(const std::filesystem::path& file);
std::filesystem::path absolute_path(const std::filesystem::path& file);
void idle_pause(std::chrono::milliseconds duration);

}
