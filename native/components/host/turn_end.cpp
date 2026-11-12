#include "gm/host/turn_end.hpp"

#include <chrono>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <sstream>
#include <string>
#include <system_error>

#include "gm/json.hpp"

namespace gm::host {
namespace fs = std::filesystem;

namespace {

std::optional<fs::path> marker_root() {
#if defined(_WIN32)
    const char* home = std::getenv("USERPROFILE");
#else
    const char* home = std::getenv("HOME");
#endif
    if (home == nullptr || *home == '\0') return std::nullopt;
    return fs::path(home) / ".gmnew" / "turn-end";
}

fs::path canonical_of(const fs::path& workspace) {
    std::error_code ec;
    const fs::path resolved = fs::weakly_canonical(workspace, ec);
    return ec ? workspace.lexically_normal() : resolved;
}

std::optional<fs::path> marker_file(const fs::path& workspace) {
    const auto root = marker_root();
    if (!root) return std::nullopt;
    std::uint64_t hash = 14695981039346656037ull;
    for (const unsigned char byte : canonical_of(workspace).string()) {
        hash ^= byte;
        hash *= 1099511628211ull;
    }
    static constexpr char digits[] = "0123456789abcdef";
    std::string name(16, '0');
    for (int at = 15; at >= 0; --at, hash >>= 4) name[static_cast<std::size_t>(at)] = digits[hash & 0xF];
    return *root / (name + ".json");
}

std::int64_t now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

}

int run_turn_end(const HostArgs&) {
    const std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    fs::path workspace = fs::current_path();
    json::Value marker;
    if (auto hook = json::parse(input); hook && hook->is_object()) {
        if (const json::Value* cwd = hook->find("cwd"); cwd != nullptr && cwd->is_string() && !cwd->as_string().empty()) workspace = cwd->as_string();
        if (const json::Value* session = hook->find("session_id"); session != nullptr && session->is_string()) marker.set("session_id", session->as_string());
    }
    const auto file = marker_file(workspace);
    if (!file) return 0;
    marker.set("workspace", canonical_of(workspace).string()).set("ended_ms", static_cast<std::uint64_t>(now_ms()));
    std::error_code ec;
    fs::create_directories(file->parent_path(), ec);
    const fs::path temp(file->string() + ".tmp");
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        out << json::dump(marker);
    }
    fs::rename(temp, *file, ec);
    return 0;
}

std::optional<std::int64_t> turn_ended_ms(const fs::path& workspace) {
    const auto file = marker_file(workspace);
    if (!file) return std::nullopt;
    std::ifstream in(*file, std::ios::binary);
    if (!in) return std::nullopt;
    std::ostringstream text;
    text << in.rdbuf();
    auto parsed = json::parse(text.str());
    if (!parsed || !parsed->is_object()) return std::nullopt;
    const json::Value* ended = parsed->find("ended_ms");
    if (ended == nullptr || !ended->is_number()) return std::nullopt;
    return static_cast<std::int64_t>(ended->as_number());
}

}
