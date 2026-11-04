#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <system_error>

#include "core_internal.hpp"

#if defined(_WIN32)
#include <io.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace gmnew::core {

namespace {

constexpr std::string_view replacement = "\xEF\xBF\xBD";

bool is_continuation(unsigned char c) { return (c & 0xC0) == 0x80; }

std::size_t sequence_length(unsigned char lead) {
    if (lead < 0x80) return 1;
    if (lead >= 0xC2 && lead <= 0xDF) return 2;
    if (lead >= 0xE0 && lead <= 0xEF) return 3;
    if (lead >= 0xF0 && lead <= 0xF4) return 4;
    return 0;
}

bool second_byte_fits(unsigned char lead, unsigned char second) {
    if (lead == 0xE0) return second >= 0xA0 && second <= 0xBF;
    if (lead == 0xED) return second >= 0x80 && second <= 0x9F;
    if (lead == 0xF0) return second >= 0x90 && second <= 0xBF;
    if (lead == 0xF4) return second >= 0x80 && second <= 0x8F;
    return is_continuation(second);
}

struct ErrnoName {
    int number;
    const char* code;
    const char* description;
};

constexpr ErrnoName errno_names[] = {
    {ENOENT, "ENOENT", "no such file or directory"},
    {EACCES, "EACCES", "permission denied"},
    {EISDIR, "EISDIR", "illegal operation on a directory"},
    {ENOTDIR, "ENOTDIR", "not a directory"},
    {EEXIST, "EEXIST", "file already exists"},
    {ENAMETOOLONG, "ENAMETOOLONG", "name too long"},
    {ELOOP, "ELOOP", "too many symbolic links encountered"},
    {EPERM, "EPERM", "operation not permitted"},
    {ENOSPC, "ENOSPC", "no space left on device"},
    {EROFS, "EROFS", "read-only file system"},
    {EBUSY, "EBUSY", "resource busy or locked"},
    {EMFILE, "EMFILE", "too many open files"},
    {EINVAL, "EINVAL", "invalid argument"},
};

}  // namespace

std::string to_valid_utf8(std::string_view bytes) {
    std::string out;
    out.reserve(bytes.size());
    std::size_t at = 0;
    while (at < bytes.size()) {
        auto lead = static_cast<unsigned char>(bytes[at]);
        std::size_t need = sequence_length(lead);
        if (need == 1) {
            out.push_back(static_cast<char>(lead));
            ++at;
            continue;
        }
        if (need == 0) {
            out.append(replacement);
            ++at;
            continue;
        }
        std::size_t got = 1;
        while (got < need && at + got < bytes.size()) {
            auto next = static_cast<unsigned char>(bytes[at + got]);
            bool fits = got == 1 ? second_byte_fits(lead, next) : is_continuation(next);
            if (!fits) break;
            ++got;
        }
        if (got == need) {
            out.append(bytes.substr(at, need));
        } else {
            out.append(replacement);
        }
        at += got;
    }
    return out;
}

std::size_t utf16_length(std::string_view text) {
    std::size_t units = 0;
    for (char ch : text) {
        auto c = static_cast<unsigned char>(ch);
        if (is_continuation(c)) continue;
        units += c >= 0xF0 ? 2 : 1;
    }
    return units;
}

std::size_t byte_at_utf16(std::string_view text, std::size_t units) {
    std::size_t counted = 0;
    std::size_t at = 0;
    while (at < text.size()) {
        auto c = static_cast<unsigned char>(text[at]);
        std::size_t width = c >= 0xF0 ? 2 : 1;
        if (counted + width > units) break;
        counted += width;
        ++at;
        while (at < text.size() && is_continuation(static_cast<unsigned char>(text[at]))) ++at;
    }
    return at;
}

std::string utf16_slice(std::string_view text, std::size_t from, std::size_t to) {
    if (to <= from) return {};
    std::size_t begin = byte_at_utf16(text, from);
    std::size_t end = byte_at_utf16(text, to);
    return std::string(text.substr(begin, end - begin));
}

std::string utf16_tail(std::string_view text, std::size_t units) {
    std::size_t length = utf16_length(text);
    if (length <= units) return std::string(text);
    return utf16_slice(text, length - units, length);
}

json::Value refusal(std::string_view reason) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("refused", true);
    reply.set("error", "refused: " + std::string(reason));
    return reply;
}

json::Value failure(std::string message) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", std::move(message));
    return reply;
}

std::string node_error(int error_number, std::string_view syscall, const std::filesystem::path* path) {
    std::string text;
    for (const auto& name : errno_names) {
        if (name.number == error_number) {
            text = std::string(name.code) + ": " + name.description;
            break;
        }
    }
    if (text.empty()) text = "E" + std::to_string(error_number) + ": " + std::strerror(error_number);
    text += ", ";
    text += syscall;
    if (path != nullptr) text += " '" + path->string() + "'";
    return text;
}

bool is_whole_number(const json::Value* v) {
    if (v == nullptr || !v->is_number()) return false;
    double n = v->as_number();
    return std::isfinite(n) && std::floor(n) == n;
}

const json::Value* present(const json::Value& args, std::string_view key) {
    const json::Value* v = args.find(key);
    if (v == nullptr || v->is_null()) return nullptr;
    return v;
}

#if defined(_WIN32)

FileText read_text(const std::filesystem::path& path, std::string_view open_syscall) {
    FileText result;
    std::error_code ec;
    auto status = std::filesystem::status(path, ec);
    if (ec) {
        result.error = node_error(ENOENT, open_syscall, &path);
        return result;
    }
    if (std::filesystem::is_directory(status)) {
        result.error = node_error(EISDIR, "read", nullptr);
        return result;
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        result.error = node_error(EACCES, "open", &path);
        return result;
    }
    std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    result.text = to_valid_utf8(bytes);
    result.ok = true;
    return result;
}

std::string write_text(const std::filesystem::path& path, std::string_view content) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) return node_error(EACCES, "open", &path);
    out.write(content.data(), static_cast<std::streamsize>(content.size()));
    if (!out) return node_error(ENOSPC, "write", nullptr);
    return {};
}

#else

FileText read_text(const std::filesystem::path& path, std::string_view open_syscall) {
    FileText result;
    struct stat info {};
    if (open_syscall == "stat" && ::stat(path.c_str(), &info) != 0) {
        result.error = node_error(errno, "stat", &path);
        return result;
    }
    int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        result.error = node_error(errno, "open", &path);
        return result;
    }
    std::string bytes;
    char chunk[1 << 16];
    for (;;) {
        ssize_t n = ::read(fd, chunk, sizeof chunk);
        if (n < 0) {
            if (errno == EINTR) continue;
            result.error = node_error(errno, "read", nullptr);
            ::close(fd);
            return result;
        }
        if (n == 0) break;
        bytes.append(chunk, static_cast<std::size_t>(n));
    }
    ::close(fd);
    result.text = to_valid_utf8(bytes);
    result.ok = true;
    return result;
}

std::string write_text(const std::filesystem::path& path, std::string_view content) {
    int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0666);
    if (fd < 0) return node_error(errno, "open", &path);
    std::size_t written = 0;
    while (written < content.size()) {
        ssize_t n = ::write(fd, content.data() + written, content.size() - written);
        if (n < 0) {
            if (errno == EINTR) continue;
            int error_number = errno;
            ::close(fd);
            return node_error(error_number, "write", nullptr);
        }
        written += static_cast<std::size_t>(n);
    }
    ::close(fd);
    return {};
}

#endif

std::shared_ptr<RunLog> LockedLog::current() const {
    std::lock_guard lock(mutex_);
    return log_;
}

void LockedLog::bind(std::shared_ptr<RunLog> log) {
    std::lock_guard lock(mutex_);
    log_ = std::move(log);
}

std::filesystem::path LockedLog::dir() const {
    auto log = current();
    return log ? log->dir() : std::filesystem::path{};
}

std::uint64_t LockedLog::append(std::string_view kind, json::Value fields) {
    auto log = current();
    return log ? log->append(kind, std::move(fields)) : 0;
}

deoxidene::Result<std::vector<json::Value>, std::string> LockedLog::read_all() {
    auto log = current();
    if (!log) return deoxidene::Err<std::string>("no run is open");
    return log->read_all();
}

}  // namespace gmnew::core
