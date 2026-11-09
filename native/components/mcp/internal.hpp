#pragma once

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "deoxidene/result.hpp"
#include "gm/json.hpp"

namespace gm::mcp::detail {

using json::Value;

inline Value object() { return Value(json::Object{}); }
inline Value array() { return Value(json::Array{}); }
inline Value number(double n) { return Value(n); }
inline Value number_of(std::uint64_t n) { return Value(static_cast<double>(n)); }

std::size_t js_length(std::string_view utf8);
std::string js_prefix(std::string_view utf8, std::size_t units);
std::string trim(std::string_view text);
std::string iso_time(std::filesystem::file_time_type when);
std::string iso_now();
bool read_file(const std::filesystem::path& file, std::string& out);
bool write_file(const std::filesystem::path& file, std::string_view bytes);

class RpcError : public std::runtime_error {
public:
    RpcError(int code, const std::string& message, std::optional<Value> data = std::nullopt)
        : std::runtime_error(message), code(code), data(std::move(data)) {}
    int code;
    std::optional<Value> data;
};

struct SkillFile {
    std::string path;
    std::string uri;
    std::string bytes;
    std::string digest;
    std::uint64_t size = 0;
    std::string mime_type;
    std::string last_modified;
};

struct Skill {
    std::string name;
    std::string uri;
    Value frontmatter;
    std::string body;
    std::vector<SkillFile> files;
};

inline const std::vector<std::string>& served_skills() {
    static const std::vector<std::string> names = {"gm", "gm-continue"};
    return names;
}

std::string clip(const std::string& text, std::size_t cap = 400);
Value output_digest(const std::string& text, bool failed);
Value args_of(const Value* args);

using EventAt = std::function<const Value*(std::uint64_t seq)>;
Value feed_of(const EventAt& at, std::uint64_t count, std::uint64_t shown, bool compact_children = false);

bool is_pending_kind(std::string_view kind);
bool is_pending_event(std::string_view kind, const Value& event);
void append_pending(const std::filesystem::path& run_dir, const Value& event);
struct PendingTake {
    std::vector<Value> records;
    std::vector<std::filesystem::path> files;
};
PendingTake take_pending(const std::filesystem::path& run_dir);
bool has_pending(const std::filesystem::path& run_dir);
void clear_pending(const std::vector<std::filesystem::path>& files);
std::uint64_t pending_generation();
void wait_pending_change(std::uint64_t seen, std::chrono::steady_clock::time_point deadline);

deoxidene::Result<Skill, std::string> read_skill(const std::filesystem::path& skills_dir, const std::string& name);

class SkillCache {
public:
    explicit SkillCache(std::filesystem::path dir) : dir_(std::move(dir)) {}
    Skill get(const std::string& name);
    const std::filesystem::path& dir() const { return dir_; }

private:
    std::filesystem::path dir_;
    std::map<std::string, Skill> last_;
};

}
