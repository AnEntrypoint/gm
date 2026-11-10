#include "platform.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>

#if defined(__wasi__)
#include <dirent.h>
#include <sys/stat.h>
#include <time.h>
#else
#include <fstream>
#include <iterator>
#include <system_error>
#include <thread>
#endif

namespace gm::platform {

#if defined(__wasi__)

std::optional<std::string> read_file(const std::filesystem::path& file) {
    FILE* in = std::fopen(file.string().c_str(), "rb");
    if (in == nullptr) return std::nullopt;
    std::string out;
    char buffer[4096];
    std::size_t count = 0;
    while ((count = std::fread(buffer, 1, sizeof buffer, in)) > 0) out.append(buffer, count);
    std::fclose(in);
    return out;
}

std::optional<FileStamp> stamp_of(const std::filesystem::path& file) {
    struct stat info {};
    if (stat(file.string().c_str(), &info) != 0) return std::nullopt;
    const std::int64_t nanoseconds = static_cast<std::int64_t>(info.st_mtim.tv_sec) * 1000000000 + info.st_mtim.tv_nsec;
    return FileStamp{nanoseconds, static_cast<std::uintmax_t>(info.st_size)};
}

bool is_regular_file(const std::filesystem::path& file) {
    struct stat info {};
    return stat(file.string().c_str(), &info) == 0 && S_ISREG(info.st_mode);
}

std::vector<std::filesystem::path> regular_files_in(const std::filesystem::path& dir) {
    std::vector<std::filesystem::path> files;
    DIR* listing = opendir(dir.string().c_str());
    if (listing == nullptr) return files;
    while (struct dirent* entry = readdir(listing)) {
        if (std::strcmp(entry->d_name, ".") == 0 || std::strcmp(entry->d_name, "..") == 0) continue;
        std::filesystem::path child = dir / entry->d_name;
        if (is_regular_file(child)) files.push_back(child);
    }
    closedir(listing);
    return files;
}

std::filesystem::path absolute_path(const std::filesystem::path& file) {
    return file;
}

void idle_pause(std::chrono::milliseconds duration) {
    const auto nanoseconds = std::chrono::duration_cast<std::chrono::nanoseconds>(duration).count();
    struct timespec pause {};
    pause.tv_sec = static_cast<time_t>(nanoseconds / 1000000000);
    pause.tv_nsec = static_cast<long>(nanoseconds % 1000000000);
    nanosleep(&pause, nullptr);
}

#else

std::optional<std::string> read_file(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    if (!in) return std::nullopt;
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

std::optional<FileStamp> stamp_of(const std::filesystem::path& file) {
    std::error_code ec;
    auto mtime = std::filesystem::last_write_time(file, ec);
    if (ec) return std::nullopt;
    auto size = std::filesystem::file_size(file, ec);
    if (ec) return std::nullopt;
    return FileStamp{static_cast<std::int64_t>(mtime.time_since_epoch().count()), size};
}

bool is_regular_file(const std::filesystem::path& file) {
    std::error_code ec;
    return std::filesystem::is_regular_file(file, ec);
}

std::vector<std::filesystem::path> regular_files_in(const std::filesystem::path& dir) {
    std::vector<std::filesystem::path> files;
    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator(dir, ec)) {
        if (entry.is_regular_file(ec)) files.push_back(entry.path());
    }
    return files;
}

std::filesystem::path absolute_path(const std::filesystem::path& file) {
    return std::filesystem::absolute(file);
}

void idle_pause(std::chrono::milliseconds duration) {
    std::this_thread::sleep_for(duration);
}

#endif

}
