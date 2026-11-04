#include "gmnew/host/cli.hpp"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <thread>

#include "gmnew/json.hpp"
#include "gmnew/query.hpp"

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <csignal>
#include <unistd.h>
#endif

namespace gmnew::host {
namespace {

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;

struct CliError {
    std::string text;
};

constexpr int kPollMs = 200;
constexpr int kLockStaleMs = 2000;
constexpr int kLockWaitMs = 5000;
constexpr long long kDefaultWaitMs = 1800000;
constexpr const char* kQueueFile = "pending.jsonl";
constexpr const char* kLockFile = "pending.lock";

std::atomic<int> g_signal{0};
void note_signal(int signal) { g_signal.store(signal); }

bool is_boolean_flag(const std::string& key) { return key == "read-clear" || key == "wait"; }

struct Flags {
    std::vector<std::pair<std::string, std::string>> values;
    bool has(const std::string& key) const { return find(key) != nullptr; }
    const std::string* find(const std::string& key) const {
        for (const auto& [name, value] : values)
            if (name == key) return &value;
        return nullptr;
    }
};

Flags parse_flags(const std::vector<std::string>& argv) {
    Flags flags;
    for (std::size_t i = 0; i < argv.size(); ++i) {
        const std::string& name = argv[i];
        if (name.rfind("--", 0) != 0) throw CliError{"unexpected argument: " + name};
        const std::string key = name.substr(2);
        if (is_boolean_flag(key)) {
            flags.values.emplace_back(key, "true");
            continue;
        }
        if (i + 1 >= argv.size() || argv[i + 1].rfind("--", 0) == 0) throw CliError{name + " needs a value"};
        flags.values.emplace_back(key, argv[i + 1]);
        ++i;
    }
    return flags;
}

bool valid_run_id(const std::string& id) {
    return !id.empty() && std::all_of(id.begin(), id.end(), [](unsigned char c) {
               return std::isalnum(c) || c == '_' || c == '-';
           });
}

fs::path run_dir_of(const Flags& flags) {
    if (const std::string* dir = flags.find("dir")) {
        const fs::path path = fs::absolute(*dir);
        if (!fs::is_directory(path)) throw CliError{"no run directory " + path.string()};
        return path;
    }
    const std::string* run = flags.find("run");
    if (run == nullptr || !valid_run_id(*run)) throw CliError{"--run <id> or --dir <run dir> is required"};
    const fs::path root = flags.has("workspace") ? fs::absolute(*flags.find("workspace")) : source_root();
    const fs::path path = root / "runs" / *run;
    if (!fs::is_directory(path)) throw CliError{"no run " + *run};
    return path;
}

long long timeout_ms_of(const Flags& flags) {
    const std::string* given = flags.find("timeout-ms");
    if (given == nullptr) return kDefaultWaitMs;
    const bool digits = !given->empty() && std::all_of(given->begin(), given->end(), [](unsigned char c) { return std::isdigit(c); });
    const long long ms = digits && given->size() < 16 ? std::stoll(*given) : 0;
    if (ms < 1) throw CliError{"--timeout-ms must be a positive integer"};
    return ms;
}

bool process_gone(long pid) {
#if defined(_WIN32)
    HANDLE handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
    if (handle == nullptr) return GetLastError() == ERROR_INVALID_PARAMETER;
    CloseHandle(handle);
    return false;
#else
    return kill(static_cast<pid_t>(pid), 0) != 0 && errno == ESRCH;
#endif
}

long current_pid() {
#if defined(_WIN32)
    return static_cast<long>(GetCurrentProcessId());
#else
    return static_cast<long>(getpid());
#endif
}

struct ReadingName {
    bool matches = false;
    bool has_pid = false;
    long pid = 0;
};

bool all_digits(const std::string& s) {
    return !s.empty() && std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c); });
}

ReadingName match_reading(const std::string& name) {
    constexpr std::string_view prefix = "pending.";
    constexpr std::string_view suffix = ".reading";
    if (name.size() <= prefix.size() + suffix.size() || name.rfind(prefix, 0) != 0 ||
        name.compare(name.size() - suffix.size(), suffix.size(), suffix) != 0)
        return {};
    const std::string middle = name.substr(prefix.size(), name.size() - prefix.size() - suffix.size());
    const std::size_t first_dash = middle.find('-');
    if (first_dash == std::string::npos || !all_digits(middle.substr(0, first_dash))) return {};
    const std::string rest = middle.substr(first_dash + 1);
    const std::size_t second_dash = rest.find('-');
    const std::string hex = rest.substr(0, second_dash);
    if (hex.empty() || !std::all_of(hex.begin(), hex.end(), [](unsigned char c) { return std::isxdigit(c) && !std::isupper(c); }))
        return {};
    if (second_dash == std::string::npos) return {true, false, 0};
    const std::string pid = rest.substr(second_dash + 1);
    if (!all_digits(pid)) return {};
    return {true, true, std::stol(pid)};
}

bool reader_gone(const ReadingName& name) { return !name.has_pid || process_gone(name.pid); }

long long epoch_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

std::string random_hex() {
    static const char digits[] = "0123456789abcdef";
    std::string out;
    unsigned seed = static_cast<unsigned>(Clock::now().time_since_epoch().count());
    for (int i = 0; i < 8; ++i) {
        seed = seed * 1103515245u + 12345u;
        out.push_back(digits[(seed >> 16) & 15]);
    }
    return out;
}

class QueueLock {
public:
    explicit QueueLock(const fs::path& run_dir) : path_(run_dir / kLockFile) {
        const auto deadline = Clock::now() + std::chrono::milliseconds(kLockWaitMs);
        for (;;) {
            if (FILE* file = std::fopen(path_.string().c_str(), "wx")) {
                std::fclose(file);
                return;
            }
            remove_if_stale();
            if (Clock::now() >= deadline) throw CliError{"the pending queue stayed locked: " + path_.string()};
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    }
    ~QueueLock() {
        std::error_code ignored;
        fs::remove(path_, ignored);
    }
    QueueLock(const QueueLock&) = delete;
    QueueLock& operator=(const QueueLock&) = delete;

private:
    void remove_if_stale() {
        std::error_code failed;
        const auto written = fs::last_write_time(path_, failed);
        if (failed) return;
        const auto age = std::chrono::duration_cast<std::chrono::milliseconds>(fs::file_time_type::clock::now() - written);
        if (age.count() > kLockStaleMs) fs::remove(path_, failed);
    }
    fs::path path_;
};

bool claim(const fs::path& run_dir, const std::string& name, fs::path& copy) {
    copy = run_dir / ("pending." + std::to_string(epoch_ms()) + "-" + random_hex() + "-" + std::to_string(current_pid()) + ".reading");
    std::error_code failed;
    fs::rename(run_dir / name, copy, failed);
    return !failed;
}

struct Taken {
    std::vector<std::string> lines;
    std::vector<fs::path> files;
};

Taken take_pending(const fs::path& run_dir) {
    Taken taken;
    std::vector<std::string> names;
    for (const auto& entry : fs::directory_iterator(run_dir)) {
        const std::string name = entry.path().filename().string();
        if (match_reading(name).matches) names.push_back(name);
    }
    std::sort(names.begin(), names.end());
    for (const std::string& name : names) {
        if (!reader_gone(match_reading(name))) continue;
        fs::path copy;
        if (claim(run_dir, name, copy)) taken.files.push_back(copy);
    }
    {
        QueueLock lock(run_dir);
        fs::path copy;
        if (claim(run_dir, kQueueFile, copy)) taken.files.push_back(copy);
    }
    for (const fs::path& file : taken.files) {
        std::ifstream in(file, std::ios::binary);
        std::string line;
        while (std::getline(in, line)) {
            if (line.find_first_not_of(" \t\r\n") == std::string::npos) continue;
            auto record = json::parse(line);
            if (!record) throw CliError{"bad pending record in " + file.string() + ": " + record.error()};
            taken.lines.push_back(json::dump(*record) + "\n");
        }
    }
    return taken;
}

void clear_pending(const std::vector<fs::path>& files) {
    for (const fs::path& file : files) {
        std::error_code ignored;
        fs::remove(file, ignored);
    }
}

void write_out(const std::string& text) {
    std::cout << text;
    std::cout.flush();
}

int signal_exit(int signal) { return signal == SIGINT ? 130 : 143; }
const char* signal_name(int signal) { return signal == SIGINT ? "SIGINT" : "SIGTERM"; }

int events_command(const HostArgs& args) {
    const Flags flags = parse_flags(args.rest);
    const fs::path dir = run_dir_of(flags);
    const bool waiting = flags.has("wait");
    const long long timeout = waiting ? timeout_ms_of(flags) : 0;
    if (waiting) {
        std::signal(SIGINT, note_signal);
        std::signal(SIGTERM, note_signal);
    }
    const auto started = Clock::now();
    auto elapsed_ms = [&] { return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count(); };
    Taken taken = take_pending(dir);
    while (taken.lines.empty() && waiting && g_signal.load() == 0 && elapsed_ms() < timeout) {
        clear_pending(taken.files);
        std::this_thread::sleep_for(std::chrono::milliseconds(kPollMs));
        taken = take_pending(dir);
    }
    if (!taken.lines.empty()) {
        std::string out;
        for (const std::string& line : taken.lines) out += line;
        write_out(out);
        clear_pending(taken.files);
        return 0;
    }
    clear_pending(taken.files);
    if (g_signal.load() != 0) {
        write_out(std::string("events: stopped by ") + signal_name(g_signal.load()) + " with no event pending\n");
        return signal_exit(g_signal.load());
    }
    if (waiting) write_out("events: timed out after " + std::to_string(timeout) + " ms with no event pending\n");
    return 0;
}

std::vector<std::string> log_lines(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::vector<std::string> lines;
    std::string line;
    while (std::getline(in, line))
        if (line.find_first_not_of(" \t\r\n") != std::string::npos) lines.push_back(line);
    return lines;
}

int query_command(const HostArgs& args) {
    const Flags flags = parse_flags(args.rest);
    const fs::path file = run_dir_of(flags) / "log.jsonl";
    if (!fs::exists(file)) throw CliError{"no log at " + file.string()};
    const std::vector<std::string> lines = log_lines(file);
    if (!flags.has("js")) {
        std::string out;
        for (const std::string& line : lines) out += line + "\n";
        write_out(out);
        return 0;
    }
    std::string array = "[";
    for (std::size_t i = 0; i < lines.size(); ++i) array += (i ? "," : "") + lines[i];
    array += "]";
    auto result = run_query(array, *flags.find("js"));
    if (!result) throw CliError{"query failed: " + result.error()};
    write_out(*result + "\n");
    return 0;
}

template <typename Command>
int guarded(Command command, const HostArgs& args) {
    try {
        return command(args);
    } catch (const CliError& err) {
        std::cerr << "gmnew: " << err.text << "\n";
        return 1;
    } catch (const std::exception& err) {
        std::cerr << "gmnew: " << err.what() << "\n";
        return 1;
    }
}

}

int run_events(const HostArgs& args) { return guarded(events_command, args); }
int run_query_command(const HostArgs& args) { return guarded(query_command, args); }

}
