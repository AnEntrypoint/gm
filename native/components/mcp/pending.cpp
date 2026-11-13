#include <algorithm>
#include <condition_variable>
#include <cstdio>
#include <fstream>
#include <mutex>
#include <random>
#include <regex>
#include <set>
#include <stdexcept>
#include <thread>

#include "gm/mcp.hpp"
#include "internal.hpp"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <process.h>
#include <windows.h>
#else
#include <cerrno>
#include <csignal>
#include <fcntl.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace gm::mcp::detail {

namespace {

namespace fs = std::filesystem;

constexpr const char* kPendingFile = "pending.jsonl";
constexpr const char* kLockFile = "pending.lock";
constexpr auto kLockStale = std::chrono::milliseconds(2000);
constexpr auto kLockWait = std::chrono::milliseconds(5000);

std::mutex generation_mutex;
std::condition_variable generation_changed;
std::uint64_t generation = 0;

const std::regex& reading_name() {
    static const std::regex pattern(R"(^pending\.\d+-[0-9a-f]+(?:-(\d+))?\.reading$)");
    return pattern;
}

long own_pid() {
#ifdef _WIN32
    return static_cast<long>(_getpid());
#else
    return static_cast<long>(getpid());
#endif
}

bool reader_gone(const std::string& pid_text) {
    if (pid_text.empty()) return true;
    long pid = std::stol(pid_text);
#ifdef _WIN32
    HANDLE process = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
    if (process == nullptr) return GetLastError() == ERROR_INVALID_PARAMETER;
    bool exited = WaitForSingleObject(process, 0) == WAIT_OBJECT_0;
    CloseHandle(process);
    return exited;
#else
    if (kill(static_cast<pid_t>(pid), 0) == 0) return false;
    return errno == ESRCH;
#endif
}

bool create_exclusive(const fs::path& file) {
#ifdef _WIN32
    int fd = _wopen(file.c_str(), _O_CREAT | _O_EXCL | _O_WRONLY, 0644);
    if (fd < 0) return false;
    _close(fd);
#else
    int fd = open(file.c_str(), O_CREAT | O_EXCL | O_WRONLY, 0644);
    if (fd < 0) return false;
    close(fd);
#endif
    return true;
}

void remove_stale_lock(const fs::path& lock) {
    std::error_code ec;
    auto when = fs::last_write_time(lock, ec);
    if (ec) return;
    if (fs::file_time_type::clock::now() - when > kLockStale) fs::remove(lock, ec);
}

template <typename Fn>
auto with_queue_lock(const fs::path& run_dir, Fn fn) {
    fs::path lock = run_dir / kLockFile;
    auto deadline = std::chrono::steady_clock::now() + kLockWait;
    while (!create_exclusive(lock)) {
        remove_stale_lock(lock);
        if (std::chrono::steady_clock::now() >= deadline) {
            throw std::runtime_error("the pending queue stayed locked: " + lock.string());
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    struct Release {
        fs::path file;
        ~Release() {
            std::error_code ec;
            fs::remove(file, ec);
        }
    } release{lock};
    return fn();
}

std::optional<fs::path> claim(const fs::path& run_dir, const std::string& name) {
    static std::mt19937 rng{std::random_device{}()};
    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex;
    for (int i = 0; i < 8; ++i) hex.push_back(kHex[rng() & 0xF]);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    fs::path copy = run_dir / ("pending." + std::to_string(ms) + "-" + hex + "-" + std::to_string(own_pid()) + ".reading");
    std::error_code ec;
    fs::rename(run_dir / name, copy, ec);
    if (ec) return std::nullopt;
    return copy;
}

std::vector<std::string> abandoned_copies(const fs::path& run_dir) {
    std::vector<std::string> names;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(run_dir, ec)) {
        std::string name = entry.path().filename().string();
        std::smatch match;
        if (std::regex_match(name, match, reading_name()) && reader_gone(match[1].str())) names.push_back(name);
    }
    std::sort(names.begin(), names.end());
    return names;
}

}

bool is_pending_kind(std::string_view kind) {
    static const std::set<std::string_view> kinds = {"job", "job-killed", "job-stuck", "job-unstuck", "rules-notice", "recovery", "host-idle", "row-added"};
    return kinds.contains(kind);
}

bool is_pending_event(std::string_view kind, const Value& event) {
    if (!is_pending_kind(kind)) return false;
    const Value* state = event.find("state");
    return !(kind == "job" && state != nullptr && state->is_string() && state->as_string() == "running");
}

void append_pending(const fs::path& run_dir, const Value& event) {
    Value record = object();
    if (const Value* seq = event.find("seq")) record.set("id", *seq);
    for (const json::Member& m : event.as_object()) record.set(m.first, m.second);
    std::string line = json::dump(record) + "\n";
    with_queue_lock(run_dir, [&] {
        std::ofstream out(run_dir / kPendingFile, std::ios::binary | std::ios::app);
        out.write(line.data(), static_cast<std::streamsize>(line.size()));
        return true;
    });
    {
        std::lock_guard lock(generation_mutex);
        generation += 1;
    }
    generation_changed.notify_all();
}

void append_to_peers(const fs::path& run_dir, const Value& event) {
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(run_dir.parent_path(), ec)) {
        if (!entry.is_directory(ec) || entry.path().filename() == run_dir.filename()) continue;
        std::ifstream owner(entry.path() / "owner");
        std::string identity;
        if (!std::getline(owner, identity) || identity.empty() || !process_identity_alive(identity)) continue;
        append_pending(entry.path(), event);
    }
}

PendingTake take_pending(const fs::path& run_dir) {
    PendingTake taken;
    for (const auto& name : abandoned_copies(run_dir)) {
        if (auto copy = claim(run_dir, name)) taken.files.push_back(*copy);
    }
    std::error_code ec;
    if (fs::exists(run_dir / kPendingFile, ec)) {
        auto queued = with_queue_lock(run_dir, [&] { return claim(run_dir, kPendingFile); });
        if (queued) taken.files.push_back(*queued);
    }
    for (const auto& file : taken.files) {
        std::string text;
        read_file(file, text);
        std::size_t at = 0;
        while (at < text.size()) {
            std::size_t nl = text.find('\n', at);
            std::string line = text.substr(at, nl == std::string::npos ? std::string::npos : nl - at);
            at = nl == std::string::npos ? text.size() : nl + 1;
            if (trim(line).empty()) continue;
            if (auto parsed = json::parse(line)) taken.records.push_back(std::move(*parsed));
        }
    }
    return taken;
}

bool has_pending(const fs::path& run_dir) {
    std::error_code ec;
    return fs::exists(run_dir / kPendingFile, ec) || !abandoned_copies(run_dir).empty();
}

void clear_pending(const std::vector<fs::path>& files) {
    for (const auto& file : files) {
        std::error_code ec;
        fs::remove(file, ec);
    }
}

std::uint64_t pending_generation() {
    std::lock_guard lock(generation_mutex);
    return generation;
}

void wait_pending_change(std::uint64_t seen, std::chrono::steady_clock::time_point deadline) {
    std::unique_lock lock(generation_mutex);
    generation_changed.wait_until(lock, deadline, [&] { return generation != seen; });
}

}

namespace gm::mcp {

void enqueue_pending(const RunLog& log, std::string_view kind, std::uint64_t seq) {
    if (seq == 0 || !detail::is_pending_kind(kind)) return;
    auto written = log.read_from(seq - 1);
    if (!written || written->empty()) return;
    if (!detail::is_pending_event(kind, written->front())) return;
    detail::append_pending(log.dir(), written->front());
    if (kind == "row-added") detail::append_to_peers(log.dir(), written->front());
}

}
